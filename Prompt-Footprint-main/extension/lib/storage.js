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

  const DEFAULT_CONFIG = { overlayEnabled: true, energyPerTokenMultiplier: 1.0 };

  // ── chrome.storage promise wrappers ──────────────────────────────────────
  function hasChrome() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function getLocal(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  function setLocal(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
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
      const d = new Date(ref.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, { date: key, tokens: 0, energyWh: 0, waterMl: 0, co2G: 0, queries: 0 });
    }

    for (const s of recent) {
      const key = new Date(s.startTime).toISOString().slice(0, 10);
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
    // pure helpers
    computeTotals,
    computeWeeklyStats,
    computePlatformBreakdown,
  };

  // Expose globally for content scripts / service worker
  if (root) root.PFStorage = PFStorage;
  // Expose for Node tests
  if (typeof module !== 'undefined' && module.exports) module.exports = PFStorage;
})(typeof self !== 'undefined' ? self : this);
