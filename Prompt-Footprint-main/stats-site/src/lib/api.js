/* global chrome */
// Data layer — local-first.
//
// Two contexts:
//   1. Extension page  — chrome.storage.local is available; read the user's
//      real on-device data (same key layout as extension/lib/storage.js).
//   2. Public web build (GitHub Pages) — no chrome, no backend; serve demo
//      data so the showcase, awards, and education pages are fully usable.
//
// There is no remote backend anymore (the project is local-first).

import { demoSessions, demoQueries, demoWeekly, demoSavings } from './demoData';
import { localDayKey } from './dates';

const SESSION_PREFIX = 'pf_session_';
const SAVINGS_KEY = 'pf_savings';
const CONFIG_KEY = 'pf_config';

const DEFAULT_CONFIG = {
  overlayEnabled: true,
  writingChecksEnabled: true,
  cloudAnalysisEnabled: false, // opt-in: draft text only leaves the device when on
  debug: false,
  proxyUrl: '',
  geminiApiKey: '',
};

export function isExtensionContext() {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
}

export function isDemoMode() {
  return !isExtensionContext();
}

export function getUserIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('userId');
}

function getAllLocal() {
  return new Promise((resolve) => chrome.storage.local.get(null, resolve));
}

async function readLocalSessions() {
  const all = await getAllLocal();
  return Object.keys(all)
    .filter((k) => k.startsWith(SESSION_PREFIX))
    .map((k) => all[k])
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
}

// Bucket sessions into the `days` calendar days ending on `endMs`, and total
// them. Bucketing and totalling share one pass over the same day keys, so the
// headline totals always equal the sum of the chart the user is looking at.
export function periodBuckets(sessions, endMs, days = 7) {
  const DAY = 24 * 60 * 60 * 1000;
  const dailyMap = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const key = localDayKey(endMs - i * DAY);
    dailyMap.set(key, { date: key, tokens: 0, energyWh: 0, waterMl: 0, co2G: 0, queries: 0 });
  }
  const totals = { totalTokens: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0, queryCount: 0, sessionCount: 0 };
  for (const s of sessions) {
    const b = dailyMap.get(localDayKey(s.startTime));
    if (!b) continue;
    b.tokens += s.totalTokens || 0;
    b.energyWh += s.totalEnergyWh || 0;
    b.waterMl += s.totalWaterMl || 0;
    b.co2G += s.totalCo2G || 0;
    b.queries += s.queryCount || 0;
    totals.totalTokens += s.totalTokens || 0;
    totals.totalEnergyWh += s.totalEnergyWh || 0;
    totals.totalWaterMl += s.totalWaterMl || 0;
    totals.totalCo2G += s.totalCo2G || 0;
    totals.queryCount += s.queryCount || 0;
    totals.sessionCount += 1;
  }
  return { totals, daily: Array.from(dailyMap.values()) };
}

// The last 7 days, plus the 7 before them so the dashboard can show how the
// week moved rather than just where it landed.
function aggregateWeekly(sessions, now = Date.now()) {
  const DAY = 24 * 60 * 60 * 1000;
  const current = periodBuckets(sessions, now, 7);
  const prior = periodBuckets(sessions, now - 7 * DAY, 7);
  return {
    totals: current.totals,
    daily: current.daily,
    previous: prior.totals,
    previousDaily: prior.daily,
  };
}

export async function fetchSessions() {
  if (isExtensionContext()) return readLocalSessions();
  return demoSessions();
}

export async function fetchWeeklyStats() {
  if (isExtensionContext()) return aggregateWeekly(await readLocalSessions());
  return demoWeekly();
}

export async function fetchQueries(sessionId) {
  if (isExtensionContext()) {
    const sessions = await readLocalSessions();
    const s = sessions.find((x) => x.id === sessionId);
    return s ? s.queries || [] : [];
  }
  return demoQueries(sessionId);
}

const EMPTY_SAVINGS = {
  applyCount: 0,
  totalTokensSaved: 0,
  totalEnergyWh: 0,
  totalWaterMl: 0,
  totalCo2G: 0,
  daily: {},
};

// Savings the user realized by clicking "Apply" on optimizer suggestions.
// Written by the content script under the `pf_savings` key.
export async function fetchSavings() {
  if (isExtensionContext()) {
    const all = await getAllLocal();
    const saved = { ...EMPTY_SAVINGS, ...(all[SAVINGS_KEY] || {}) };
    return { ...saved, previous: priorWeekSavings(saved.daily) };
  }
  return demoSavings();
}

// Totals for the seven days *before* the current week, read back out of the
// per-day savings ledger the content script writes. Used for the delta pills.
function priorWeekSavings(daily, now = Date.now()) {
  const DAY = 24 * 60 * 60 * 1000;
  const out = { applyCount: 0, totalTokensSaved: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0 };
  if (!daily) return out;
  for (let i = 13; i >= 7; i--) {
    const d = daily[localDayKey(now - i * DAY)];
    if (!d) continue;
    out.applyCount += d.count || 0;
    out.totalTokensSaved += d.tokens || 0;
    out.totalEnergyWh += d.energyWh || 0;
    out.totalWaterMl += d.waterMl || 0;
    out.totalCo2G += d.co2G || 0;
  }
  return out;
}

// ── Settings (pf_config) ────────────────────────────────────────────────────
// Same key layout as extension/lib/storage.js. In demo mode (public web build)
// there's no chrome.storage, so reads return defaults and writes are no-ops.
export async function fetchConfig() {
  if (!isExtensionContext()) return { ...DEFAULT_CONFIG };
  const all = await getAllLocal();
  return { ...DEFAULT_CONFIG, ...(all[CONFIG_KEY] || {}) };
}

export async function saveConfig(patch) {
  if (!isExtensionContext()) return { ...DEFAULT_CONFIG, ...patch };
  const all = await getAllLocal();
  const next = { ...DEFAULT_CONFIG, ...(all[CONFIG_KEY] || {}), ...patch };
  await new Promise((resolve) => chrome.storage.local.set({ [CONFIG_KEY]: next }, resolve));
  return next;
}

// Mirror of extension/lib/proxyConfig.js resolveWritingProvider (kept tiny so
// the dashboard has no cross-package import).
export function resolveWritingProvider(config) {
  const url = config && config.proxyUrl;
  const httpsUrl = typeof url === 'string' && /^https:\/\/\S+$/i.test(url.trim());
  if (httpsUrl) return 'gemini';
  if (config && typeof config.geminiApiKey === 'string' && config.geminiApiKey.trim()) return 'gemini';
  return 'local';
}
