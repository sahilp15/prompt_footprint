const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/storage.js');

const NOW = new Date('2026-06-29T12:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

function session(daysAgo, platform, tokens) {
  return {
    startTime: new Date(NOW - daysAgo * DAY).toISOString(),
    platform,
    totalTokens: tokens,
    totalEnergyWh: tokens * 0.001,
    totalWaterMl: tokens * 0.003,
    totalCo2G: tokens * 0.0004,
    totalResponseTimeMs: 1000,
    queryCount: 1,
  };
}

test('computeTotals sums across sessions', () => {
  const t = S.computeTotals([session(0, 'chatgpt', 100), session(1, 'claude', 50)]);
  assert.strictEqual(t.totalTokens, 150);
  assert.strictEqual(t.sessionCount, 2);
  assert.strictEqual(t.queryCount, 2);
});

test('computeWeeklyStats: 7 daily buckets and 7-day cutoff', () => {
  const sessions = [
    session(0, 'chatgpt', 100),
    session(6, 'claude', 50),
    session(30, 'chatgpt', 999), // outside the window
  ];
  const wk = S.computeWeeklyStats(sessions, NOW);
  assert.strictEqual(wk.daily.length, 7);
  assert.strictEqual(wk.totals.totalTokens, 150); // 999 excluded
  assert.strictEqual(wk.totals.sessionCount, 2);
});

test('computeWeeklyStats: tokens land in the correct daily bucket', () => {
  const wk = S.computeWeeklyStats([session(0, 'chatgpt', 100)], NOW);
  const today = new Date(NOW).toISOString().slice(0, 10);
  const bucket = wk.daily.find((d) => d.date === today);
  assert.ok(bucket);
  assert.strictEqual(bucket.tokens, 100);
});

test('computePlatformBreakdown groups by platform', () => {
  const bd = S.computePlatformBreakdown([
    session(0, 'chatgpt', 100),
    session(1, 'chatgpt', 25),
    session(2, 'claude', 50),
  ]);
  const map = Object.fromEntries(bd.map((b) => [b.platform, b]));
  assert.strictEqual(map.chatgpt.totalTokens, 125);
  assert.strictEqual(map.chatgpt.sessionCount, 2);
  assert.strictEqual(map.claude.totalTokens, 50);
});

test('mergeSavings accumulates totals, applyCount and per-day buckets', () => {
  let s = S.emptySavings();
  s = S.mergeSavings(s, { savedTokens: 10, savedEnergyWh: 0.01, savedWaterMl: 0.03, savedCo2G: 0.004 }, '2026-06-29');
  s = S.mergeSavings(s, { savedTokens: 5, savedEnergyWh: 0.005, savedWaterMl: 0.015, savedCo2G: 0.002 }, '2026-06-29');
  s = S.mergeSavings(s, { savedTokens: 7, savedEnergyWh: 0.007, savedWaterMl: 0.021, savedCo2G: 0.003 }, '2026-06-30');

  assert.strictEqual(s.applyCount, 3);
  assert.strictEqual(s.totalTokensSaved, 22);
  assert.ok(Math.abs(s.totalEnergyWh - 0.022) < 1e-9);
  assert.strictEqual(s.daily['2026-06-29'].count, 2);
  assert.strictEqual(s.daily['2026-06-29'].tokens, 15);
  assert.strictEqual(s.daily['2026-06-30'].count, 1);
  assert.strictEqual(s.daily['2026-06-30'].tokens, 7);
});

test('emptySavings is a clean zeroed aggregate', () => {
  const s = S.emptySavings();
  assert.strictEqual(s.applyCount, 0);
  assert.strictEqual(s.totalTokensSaved, 0);
  assert.deepStrictEqual(s.daily, {});
});
