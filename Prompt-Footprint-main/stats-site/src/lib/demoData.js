// Deterministic sample data for the public build (no backend, no user).
// ---------------------------------------------------------------------------
// Every environmental figure here comes from `impactForTokens` — the same
// implementation the extension uses, held to it by test/parity.test.ts. This
// file used to carry its own copy of the per-token constants, which is exactly
// how a showcase drifts away from the product it is showing.
//
// The numbers are shaped to be realistic, and every surface that renders them
// is required to label them SAMPLE DATA.

import { impactForTokens } from './tokenCutter/tokens.ts';
import { localDayKey } from './dates';

const DAY = 24 * 60 * 60 * 1000;

function impact(tokens, platform) {
  return impactForTokens(tokens, platform);
}

function makeQuery(id, promptTokens, responseTokens, platform, responseTimeMs) {
  const totalTokens = promptTokens + responseTokens;
  const i = impact(totalTokens, platform);
  return {
    id,
    promptTokens,
    responseTokens,
    totalTokens,
    platform,
    responseTimeMs,
    energyWh: i.energyWh,
    waterMl: i.waterMl,
    co2G: i.co2G,
  };
}

// Two weeks of sessions across ChatGPT and Claude, so the dashboard's
// period-over-period comparison has a real prior period. The older week is a
// little heavier: the sample should read as usage trending down.
const SESSION_SPECS = [
  { dayOffset: 0, platform: 'chatgpt', queries: [[60, 320, 4200], [45, 210, 2600], [120, 540, 7800]] },
  { dayOffset: 1, platform: 'claude', queries: [[90, 680, 9100], [55, 300, 3500]] },
  { dayOffset: 2, platform: 'chatgpt', queries: [[40, 180, 2100]] },
  { dayOffset: 3, platform: 'claude', queries: [[150, 900, 12500], [70, 410, 5200], [30, 160, 1900]] },
  { dayOffset: 5, platform: 'chatgpt', queries: [[200, 1100, 14000], [80, 360, 4300]] },
  { dayOffset: 6, platform: 'claude', queries: [[110, 720, 9800]] },
  // ── the previous seven days ──
  { dayOffset: 7, platform: 'chatgpt', queries: [[80, 420, 5200], [60, 280, 3300]] },
  { dayOffset: 8, platform: 'claude', queries: [[140, 860, 11800], [70, 390, 4800]] },
  { dayOffset: 9, platform: 'chatgpt', queries: [[180, 980, 12600]] },
  { dayOffset: 10, platform: 'claude', queries: [[95, 610, 8200], [50, 240, 2900], [35, 190, 2200]] },
  { dayOffset: 11, platform: 'chatgpt', queries: [[220, 1240, 15500], [75, 330, 4000]] },
  { dayOffset: 12, platform: 'claude', queries: [[130, 780, 10400]] },
  { dayOffset: 13, platform: 'chatgpt', queries: [[65, 300, 3600], [40, 170, 2000]] },
];

function buildSessions(now = Date.now()) {
  return SESSION_SPECS.map((spec, si) => {
    // Hour varies per session so the ledger reads like a fortnight of real use
    // rather than fourteen rows stamped at the same minute. Deterministic:
    // derived from the index, never from a clock or a random source.
    const hourOffset = 2 + ((si * 5) % 9);
    const start = now - spec.dayOffset * DAY - hourOffset * 60 * 60 * 1000 - (si % 4) * 17 * 60 * 1000;
    const queries = spec.queries.map((q, qi) =>
      makeQuery(`demo-q-${si}-${qi}`, q[0], q[1], spec.platform, q[2])
    );
    const totals = queries.reduce(
      (a, q) => ({
        totalTokens: a.totalTokens + q.totalTokens,
        totalEnergyWh: a.totalEnergyWh + q.energyWh,
        totalWaterMl: a.totalWaterMl + q.waterMl,
        totalCo2G: a.totalCo2G + q.co2G,
        totalResponseTimeMs: a.totalResponseTimeMs + q.responseTimeMs,
      }),
      { totalTokens: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0, totalResponseTimeMs: 0 }
    );
    const durationMs = 8 * 60 * 1000 + si * 90 * 1000;
    return {
      id: `demo-s-${si}`,
      platform: spec.platform,
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + durationMs).toISOString(),
      ...totals,
      queryCount: queries.length,
      queries,
    };
  });
}

export function demoSessions() {
  return buildSessions().sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
}

export function demoQueries(sessionId) {
  const s = buildSessions().find((x) => x.id === sessionId);
  return s ? s.queries : [];
}

// Sample Apply-savings: two weeks of optimizer usage, each day carrying both
// the tokens removed AND the original prompt total they came out of, so the
// dashboard can report an average reduction against a real denominator.
//
// Two constraints the numbers have to respect, or the sample contradicts
// itself on screen:
//   · an optimization happens to a prompt, so the per-week optimization count
//     can never exceed the per-week prompt count in SESSION_SPECS (8 of 12
//     this week, 7 of 13 the week before);
//   · `original` is always greater than `tokens`, and the implied per-day
//     reduction stays in the 15–25% band the local optimizer really produces
//     on wordy prompts.
const SAVINGS_PER_DAY = [
  // ── the previous seven days ──
  { count: 1, tokens: 22, original: 118 },
  { count: 0, tokens: 0, original: 0 },
  { count: 2, tokens: 41, original: 214 },
  { count: 1, tokens: 19, original: 99 },
  { count: 0, tokens: 0, original: 0 },
  { count: 2, tokens: 47, original: 238 },
  { count: 1, tokens: 26, original: 131 },
  // ── the last seven days (final entry is today) ──
  { count: 1, tokens: 24, original: 126 },
  { count: 1, tokens: 18, original: 97 },
  { count: 2, tokens: 44, original: 221 },
  { count: 0, tokens: 0, original: 0 },
  { count: 1, tokens: 29, original: 142 },
  { count: 2, tokens: 62, original: 292 },
  { count: 1, tokens: 21, original: 108 },
];

export function demoSavings(now = Date.now()) {
  const daily = {};
  const blank = () => ({
    applyCount: 0, totalTokensSaved: 0, totalOriginalTokens: 0,
    totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0,
  });
  const totals = blank();
  const previous = blank();

  for (let i = 13; i >= 0; i--) {
    const key = localDayKey(now - i * DAY);
    const spec = SAVINGS_PER_DAY[13 - i];
    const im = impact(spec.tokens, 'chatgpt');
    daily[key] = {
      count: spec.count,
      tokens: spec.tokens,
      originalTokens: spec.original,
      energyWh: im.energyWh,
      waterMl: im.waterMl,
      co2G: im.co2G,
    };
    const into = i >= 7 ? previous : totals;
    into.applyCount += spec.count;
    into.totalTokensSaved += spec.tokens;
    into.totalOriginalTokens += spec.original;
    into.totalEnergyWh += im.energyWh;
    into.totalWaterMl += im.waterMl;
    into.totalCo2G += im.co2G;
  }
  return { ...totals, daily, previous };
}

export function demoWeekly(now = Date.now()) {
  const sessions = buildSessions(now);
  const current = bucketRange(sessions, now);
  const prior = bucketRange(sessions, now - 7 * DAY);
  return {
    totals: current.totals,
    daily: current.daily,
    previous: prior.totals,
    previousDaily: prior.daily,
  };
}

// Same shape as `periodBuckets` in lib/api.js — kept local so the demo module
// stays independent of the data layer that imports it.
function bucketRange(sessions, endMs, days = 7) {
  const dailyMap = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const key = localDayKey(endMs - i * DAY);
    dailyMap.set(key, { date: key, tokens: 0, energyWh: 0, waterMl: 0, co2G: 0, queries: 0 });
  }
  const totals = { totalTokens: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0, queryCount: 0, sessionCount: 0 };
  for (const s of sessions) {
    const b = dailyMap.get(localDayKey(s.startTime));
    if (!b) continue;
    b.tokens += s.totalTokens;
    b.energyWh += s.totalEnergyWh;
    b.waterMl += s.totalWaterMl;
    b.co2G += s.totalCo2G;
    b.queries += s.queryCount;
    totals.totalTokens += s.totalTokens;
    totals.totalEnergyWh += s.totalEnergyWh;
    totals.totalWaterMl += s.totalWaterMl;
    totals.totalCo2G += s.totalCo2G;
    totals.queryCount += s.queryCount;
    totals.sessionCount += 1;
  }
  return { totals, daily: Array.from(dailyMap.values()) };
}
