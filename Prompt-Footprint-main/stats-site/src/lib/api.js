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

function aggregateWeekly(sessions, now = Date.now()) {
  const DAY = 24 * 60 * 60 * 1000;
  const recent = sessions.filter((s) => new Date(s.startTime).getTime() >= now - 7 * DAY);
  const dailyMap = new Map();
  for (let i = 6; i >= 0; i--) {
    const key = localDayKey(now - i * DAY);
    dailyMap.set(key, { date: key, tokens: 0, energyWh: 0, waterMl: 0, co2G: 0, queries: 0 });
  }
  const totals = { totalTokens: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0, queryCount: 0, sessionCount: 0 };
  for (const s of recent) {
    const key = localDayKey(s.startTime);
    const b = dailyMap.get(key);
    if (b) {
      b.tokens += s.totalTokens || 0;
      b.energyWh += s.totalEnergyWh || 0;
      b.waterMl += s.totalWaterMl || 0;
      b.co2G += s.totalCo2G || 0;
      b.queries += s.queryCount || 0;
    }
    totals.totalTokens += s.totalTokens || 0;
    totals.totalEnergyWh += s.totalEnergyWh || 0;
    totals.totalWaterMl += s.totalWaterMl || 0;
    totals.totalCo2G += s.totalCo2G || 0;
    totals.queryCount += s.queryCount || 0;
    totals.sessionCount += 1;
  }
  return { totals, daily: Array.from(dailyMap.values()) };
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
    return { ...EMPTY_SAVINGS, ...(all[SAVINGS_KEY] || {}) };
  }
  return demoSavings();
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
