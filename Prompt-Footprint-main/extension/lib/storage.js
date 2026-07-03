// PromptFootprint Local Storage Layer
// ---------------------------------------------------------------------------
// Local-first persistence over chrome.storage.local. Replaces the previous
// Railway/Postgres backend: all session/query/config data lives on-device.
// This improves privacy (no prompt metadata leaves the browser) and removes
// the hosting dependency entirely.
//
// Storage layout (chrome.storage.local):
//   pf_userId                 -> string (anonymous UUID)
//   pf_config                 -> { overlayEnabled, energyPerTokenMultiplier }
//   pf_session_<sessionId>    -> Session object (queries nested inline)
//
// Each browser tab owns exactly one session id, so per-session keys keep
// concurrent writes from different tabs isolated (no shared-array clobbering).
//
// This file is loaded in three contexts:
//   - content scripts (manifest content_scripts)
//   - the service worker (via importScripts)
//   - Node unit tests (pure aggregation helpers via module.exports)
// The chrome.* APIs are only touched at call time, so the pure helpers below
// (computeTotals, computeWeeklyStats, computePlatformBreakdown) are testable
// without a chrome stub.

(function (root) {
  'use strict';

  const USER_ID_KEY = 'pf_userId';
  const CONFIG_KEY = 'pf_config';
  const SESSION_PREFIX = 'pf_session_';
  const SAVINGS_KEY = 'pf_savings';

  const DEFAULT_CONFIG = { overlayEnabled: true, energyPerTokenMultiplier: 1.0 };

  // ── chrome.storage promise wrappers ──────────────────────────────────────
  function hasChrome() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function getLocal(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result);
      });
    });
  }
  function setLocal(obj) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for environments without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ── Dates ──────────────────────────────────────────────────────────────---
  // Timestamps are stored as UTC ISO strings (correct — they are instants). But
  // day grouping and reset windows must follow the user's LOCAL calendar day so
  // "today" and the weekly buckets match the clock on the wall, not UTC. Build
  // the key from local parts rather than slicing an ISO string (which is UTC).
  function localDayKey(dateLike) {
    const d = dateLike == null ? new Date() : (dateLike instanceof Date ? dateLike : new Date(dateLike));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ── User id ──────────────────────────────────────────────────────────────
  async function getUserId() {
    const res = await getLocal([USER_ID_KEY]);
    if (res[USER_ID_KEY]) return res[USER_ID_KEY];
    const id = uuid();
    await setLocal({ [USER_ID_KEY]: id });
    return id;
  }

  // ── Config ─────────────────────────────────────────────────────────────--
  async function getConfig() {
    const res = await getLocal([CONFIG_KEY]);
    return { ...DEFAULT_CONFIG, ...(res[CONFIG_KEY] || {}) };
  }

  async function setConfig(patch) {
    const current = await getConfig();
    const next = { ...current };
    if (typeof patch.overlayEnabled === 'boolean') next.overlayEnabled = patch.overlayEnabled;
    if (typeof patch.debug === 'boolean') next.debug = patch.debug;
    if (typeof patch.writingChecksEnabled === 'boolean') next.writingChecksEnabled = patch.writingChecksEnabled;
    // AI writing layer config (kept on-device; the Gemini key, if any, never
    // leaves chrome.storage.local — it is only read by the service worker).
    if (typeof patch.proxyUrl === 'string') next.proxyUrl = patch.proxyUrl.trim();
    if (typeof patch.geminiApiKey === 'string') next.geminiApiKey = patch.geminiApiKey.trim();
    if (
      typeof patch.energyPerTokenMultiplier === 'number' &&
      patch.energyPerTokenMultiplier > 0 &&
      patch.energyPerTokenMultiplier <= 20
    ) {
      next.energyPerTokenMultiplier = patch.energyPerTokenMultiplier;
    }
    await setLocal({ [CONFIG_KEY]: next });
    return next;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────
  function sessionKey(id) {
    return SESSION_PREFIX + id;
  }

  async function createSession(userId, platform) {
    const id = uuid();
    const session = {
      id,
      userId,
      platform: platform || 'unknown',
      startTime: new Date().toISOString(),
      endTime: null,
      totalTokens: 0,
      totalEnergyWh: 0,
      totalWaterMl: 0,
      totalCo2G: 0,
      totalResponseTimeMs: 0,
      queryCount: 0,
      queries: [],
    };
    await setLocal({ [sessionKey(id)]: session });
    return session;
  }

  async function getSession(id) {
    const res = await getLocal([sessionKey(id)]);
    return res[sessionKey(id)] || null;
  }

  async function endSession(id) {
    const session = await getSession(id);
    if (!session || session.endTime) return session;
    session.endTime = new Date().toISOString();
    await setLocal({ [sessionKey(id)]: session });
    return session;
  }

  // Append a query and update the owning session's running totals.
  async function addQuery(sessionId, query) {
    const session = await getSession(sessionId);
    if (!session) return null;

    const record = {
      id: uuid(),
      sessionId,
      platform: query.platform || session.platform,
      timestamp: new Date().toISOString(),
      promptTokens: query.promptTokens || 0,
      responseTokens: query.responseTokens || 0,
      totalTokens: query.totalTokens || 0,
      energyWh: query.energyWh || 0,
      waterMl: query.waterMl || 0,
      co2G: query.co2G || 0,
      responseTimeMs: query.responseTimeMs || 0,
    };

    session.queries.push(record);
    session.totalTokens += record.totalTokens;
    session.totalEnergyWh += record.energyWh;
    session.totalWaterMl += record.waterMl;
    session.totalCo2G += record.co2G;
    session.totalResponseTimeMs += record.responseTimeMs;
    session.queryCount += 1;

    await setLocal({ [sessionKey(session.id)]: session });
    return record;
  }

  // Return all sessions for a user, newest first.
  async function getSessions(userId) {
    const all = await getLocal(null);
    const sessions = [];
    for (const key of Object.keys(all)) {
      if (key.startsWith(SESSION_PREFIX)) {
        const s = all[key];
        if (!userId || s.userId === userId) sessions.push(s);
      }
    }
    sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    return sessions;
  }

  async function getWeeklyStats(userId) {
    const sessions = await getSessions(userId);
    return computeWeeklyStats(sessions);
  }

  async function getPlatformBreakdown(userId) {
    const sessions = await getSessions(userId);
    return computePlatformBreakdown(sessions);
  }

  // ── Savings (prompt-optimizer Apply clicks) ──────────────────────────────
  // Tracks ONLY savings the user actually realized by clicking "Apply" on a
  // suggestion — never ignored suggestions. Aggregated totals plus a per-day
  // series so the dashboard can chart savings over time.
  function emptySavings() {
    return {
      applyCount: 0,
      totalTokensSaved: 0,
      totalEnergyWh: 0,
      totalWaterMl: 0,
      totalCo2G: 0,
      daily: {},
    };
  }

  async function getSavings() {
    const res = await getLocal([SAVINGS_KEY]);
    return { ...emptySavings(), ...(res[SAVINGS_KEY] || {}) };
  }

  // Merge one Apply event into the aggregate. `entry` carries the realized
  // savings for that click; missing fields default to 0.
  function mergeSavings(current, entry, day) {
    const s = { ...emptySavings(), ...(current || {}) };
    const tokens = entry.savedTokens || 0;
    const energyWh = entry.savedEnergyWh || 0;
    const waterMl = entry.savedWaterMl || 0;
    const co2G = entry.savedCo2G || 0;

    s.applyCount += 1;
    s.totalTokensSaved += tokens;
    s.totalEnergyWh += energyWh;
    s.totalWaterMl += waterMl;
    s.totalCo2G += co2G;

    const key = day || localDayKey();
    const bucket = s.daily[key] || { count: 0, tokens: 0, energyWh: 0, waterMl: 0, co2G: 0 };
    bucket.count += 1;
    bucket.tokens += tokens;
    bucket.energyWh += energyWh;
    bucket.waterMl += waterMl;
    bucket.co2G += co2G;
    s.daily = { ...s.daily, [key]: bucket };
    return s;
  }

  async function addSavings(entry) {
    if (!entry) return null;
    const current = await getSavings();
    const next = mergeSavings(current, entry);
    await setLocal({ [SAVINGS_KEY]: next });
    return next;
  }

  // ── Pure aggregation helpers (unit-testable, no chrome dependency) ─────────
  function computeTotals(sessions) {
    return sessions.reduce(
      (acc, s) => {
        acc.totalTokens += s.totalTokens || 0;
        acc.totalEnergyWh += s.totalEnergyWh || 0;
        acc.totalWaterMl += s.totalWaterMl || 0;
        acc.totalCo2G += s.totalCo2G || 0;
        acc.totalResponseTimeMs += s.totalResponseTimeMs || 0;
        acc.queryCount += s.queryCount || 0;
        acc.sessionCount += 1;
        return acc;
      },
      {
        totalTokens: 0,
        totalEnergyWh: 0,
        totalWaterMl: 0,
        totalCo2G: 0,
        totalResponseTimeMs: 0,
        queryCount: 0,
        sessionCount: 0,
      }
    );
  }

  // Mirrors the shape returned by the legacy server's weekly endpoint:
  // { totals, daily: [{ date, tokens, energyWh, waterMl, co2G, queries }] }
  function computeWeeklyStats(sessions, now) {
    const ref = now ? new Date(now) : new Date();
    const cutoff = new Date(ref.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recent = sessions.filter((s) => new Date(s.startTime) >= cutoff);

    const dailyMap = new Map();
    for (let i = 6; i >= 0; i--) {
      const key = localDayKey(ref.getTime() - i * 24 * 60 * 60 * 1000);
      dailyMap.set(key, { date: key, tokens: 0, energyWh: 0, waterMl: 0, co2G: 0, queries: 0 });
    }

    for (const s of recent) {
      const key = localDayKey(s.startTime);
      const bucket = dailyMap.get(key);
      if (!bucket) continue;
      bucket.tokens += s.totalTokens || 0;
      bucket.energyWh += s.totalEnergyWh || 0;
      bucket.waterMl += s.totalWaterMl || 0;
      bucket.co2G += s.totalCo2G || 0;
      bucket.queries += s.queryCount || 0;
    }

    return { totals: computeTotals(recent), daily: Array.from(dailyMap.values()) };
  }

  function computePlatformBreakdown(sessions) {
    const map = {};
    for (const s of sessions) {
      const p = s.platform || 'unknown';
      if (!map[p]) {
        map[p] = {
          platform: p,
          totalTokens: 0,
          totalEnergyWh: 0,
          totalWaterMl: 0,
          totalCo2G: 0,
          queryCount: 0,
          sessionCount: 0,
        };
      }
      map[p].totalTokens += s.totalTokens || 0;
      map[p].totalEnergyWh += s.totalEnergyWh || 0;
      map[p].totalWaterMl += s.totalWaterMl || 0;
      map[p].totalCo2G += s.totalCo2G || 0;
      map[p].queryCount += s.queryCount || 0;
      map[p].sessionCount += 1;
    }
    return Object.values(map);
  }

  const PFStorage = {
    USER_ID_KEY,
    CONFIG_KEY,
    SESSION_PREFIX,
    SAVINGS_KEY,
    DEFAULT_CONFIG,
    hasChrome,
    getUserId,
    getConfig,
    setConfig,
    createSession,
    getSession,
    endSession,
    addQuery,
    getSessions,
    getWeeklyStats,
    getPlatformBreakdown,
    getSavings,
    addSavings,
    // pure helpers
    localDayKey,
    emptySavings,
    mergeSavings,
    computeTotals,
    computeWeeklyStats,
    computePlatformBreakdown,
  };

  // Expose globally for content scripts / service worker
  if (root) root.PFStorage = PFStorage;
  // Expose for Node tests
  if (typeof module !== 'undefined' && module.exports) module.exports = PFStorage;
})(typeof self !== 'undefined' ? self : this);
