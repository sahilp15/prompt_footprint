// Deterministic demo data for the public showcase build (no backend, no user).
// Numbers are realistic for the PromptFootprint model (energy ~1e-3 Wh/token,
// scaled up slightly for Claude and for slower/longer responses).

import { localDayKey } from './dates';

const DAY = 24 * 60 * 60 * 1000;

const PER_TOKEN = { energyWh: 0.00106, waterMl: 0.00354, co2G: 0.000375 };

function impact(tokens, factor = 1) {
  return {
    energyWh: tokens * PER_TOKEN.energyWh * factor,
    waterMl: tokens * PER_TOKEN.waterMl * factor,
    co2G: tokens * PER_TOKEN.co2G * factor,
  };
}

function makeQuery(id, promptTokens, responseTokens, platform, responseTimeMs) {
  const totalTokens = promptTokens + responseTokens;
  const factor = platform === 'claude' ? 1.15 : 1.0;
  const i = impact(totalTokens, factor);
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

// Six sessions across the last week, mixing ChatGPT and Claude — plus the week
// before, so the dashboard's week-over-week comparison has something to
// compare against. The older week is deliberately a little heavier: the
// showcase should read as usage trending down.
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
    const start = now - spec.dayOffset * DAY - 3 * 60 * 60 * 1000;
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

// Sample Apply-savings for the public showcase: two weeks of optimizer usage,
// so the Savings page can show its own week-over-week movement.
const SAVINGS_PER_DAY = [
  // 13 days ago → yesterday → today (index 13 is today)
  { count: 1, tokens: 16 },
  { count: 0, tokens: 0 },
  { count: 2, tokens: 34 },
  { count: 1, tokens: 27 },
  { count: 1, tokens: 19 },
  { count: 2, tokens: 41 },
  { count: 0, tokens: 0 },
  { count: 2, tokens: 38 },
  { count: 1, tokens: 22 },
  { count: 3, tokens: 71 },
  { count: 0, tokens: 0 },
  { count: 2, tokens: 49 },
  { count: 4, tokens: 96 },
  { count: 1, tokens: 18 },
];

export function demoSavings(now = Date.now()) {
  const daily = {};
  const totals = { applyCount: 0, totalTokensSaved: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0 };
  const previous = { applyCount: 0, totalTokensSaved: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0 };

  for (let i = 13; i >= 0; i--) {
    const key = localDayKey(now - i * DAY);
    const spec = SAVINGS_PER_DAY[13 - i];
    const im = impact(spec.tokens);
    const bucket = { count: spec.count, tokens: spec.tokens, energyWh: im.energyWh, waterMl: im.waterMl, co2G: im.co2G };
    daily[key] = bucket;
    const into = i >= 7 ? previous : totals;
    into.applyCount += spec.count;
    into.totalTokensSaved += spec.tokens;
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
