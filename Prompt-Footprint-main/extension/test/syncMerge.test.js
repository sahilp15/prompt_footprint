const test = require('node:test');
const assert = require('node:assert');
const M = require('../lib/syncMerge.js');

function localSession(id, queryCount, endTime) {
  return {
    id, userId: 'u', platform: 'chatgpt',
    startTime: '2026-06-30T10:00:00.000Z', endTime: endTime || null,
    totalTokens: 100, totalEnergyWh: 0.1, totalWaterMl: 0.3, totalCo2G: 0.05,
    totalResponseTimeMs: 2000, queryCount, queries: [],
  };
}

test('mergeSessions is idempotent: merging a list with itself equals the list', () => {
  const a = [localSession('s1', 2), localSession('s2', 1)];
  const merged = M.mergeSessions(a, a);
  assert.strictEqual(merged.length, 2);
  // Same ids, one row each (no duplicates).
  assert.deepStrictEqual(new Set(merged.map((s) => s.id)), new Set(['s1', 's2']));
});

test('mergeSessions never duplicates a session id and keeps the higher queryCount', () => {
  const local = [localSession('s1', 1)];
  const remote = [localSession('s1', 5)]; // same session, further along
  const merged = M.mergeSessions(local, remote);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].queryCount, 5);
});

test('mergeSessions unions distinct sessions and adds remote-only ones', () => {
  const local = [localSession('s1', 2)];
  const remote = [localSession('s2', 3)];
  const merged = M.mergeSessions(local, remote);
  assert.deepStrictEqual(new Set(merged.map((s) => s.id)), new Set(['s1', 's2']));
});

test('normalizeRemoteSession converts a snake_case row to a local session with no queries', () => {
  const row = {
    session_id: 's9', user_id: 'u', platform: 'claude',
    start_time: 't0', end_time: 't1',
    total_tokens: 200, total_energy_wh: 0.2, total_water_ml: 0.6, total_co2_g: 0.1,
    total_response_time_ms: 3000, query_count: 4,
  };
  const s = M.normalizeRemoteSession(row, 'u');
  assert.strictEqual(s.id, 's9');
  assert.strictEqual(s.platform, 'claude');
  assert.strictEqual(s.totalTokens, 200);
  assert.deepStrictEqual(s.queries, []);
});

test('mergeSavingsDaily is idempotent and never sums across the same day (no double-count)', () => {
  const localDaily = { '2026-06-30': { count: 3, tokens: 30, energyWh: 0.03, waterMl: 0.1, co2G: 0.01 } };
  const remoteRows = [{ day: '2026-06-30', count: 3, tokens: 30, energy_wh: 0.03, water_ml: 0.1, co2_g: 0.01 }];
  const merged = M.mergeSavingsDaily(localDaily, remoteRows);
  // Same day, same values -> stays 30, NOT 60.
  assert.strictEqual(merged['2026-06-30'].tokens, 30);
  // Re-merging the result with the same remote is still 30.
  const again = M.mergeSavingsDaily(merged, remoteRows);
  assert.strictEqual(again['2026-06-30'].tokens, 30);
});

test('mergeSavingsDaily keeps the larger realized total per day (never over-counts)', () => {
  const localDaily = { '2026-06-30': { count: 3, tokens: 30, energyWh: 0.03, waterMl: 0.1, co2G: 0.01 } };
  const remoteRows = [{ day: '2026-06-30', count: 5, tokens: 50, energy_wh: 0.05, water_ml: 0.2, co2_g: 0.02 }];
  const merged = M.mergeSavingsDaily(localDaily, remoteRows);
  assert.strictEqual(merged['2026-06-30'].tokens, 50);
  assert.strictEqual(merged['2026-06-30'].count, 5);
});

test('mergeSavingsDaily unions distinct days', () => {
  const localDaily = { '2026-06-29': { count: 1, tokens: 10, energyWh: 0, waterMl: 0, co2G: 0 } };
  const remoteRows = [{ day: '2026-06-30', count: 2, tokens: 20, energy_wh: 0, water_ml: 0, co2_g: 0 }];
  const merged = M.mergeSavingsDaily(localDaily, remoteRows);
  assert.deepStrictEqual(new Set(Object.keys(merged)), new Set(['2026-06-29', '2026-06-30']));
});

test('recomputeSavingsTotals derives totals from the daily map (Σ), never accumulates', () => {
  const daily = {
    '2026-06-29': { count: 1, tokens: 10, energyWh: 0.01, waterMl: 0.05, co2G: 0.002 },
    '2026-06-30': { count: 2, tokens: 20, energyWh: 0.02, waterMl: 0.10, co2G: 0.004 },
  };
  const t = M.recomputeSavingsTotals(daily);
  assert.strictEqual(t.applyCount, 3);
  assert.strictEqual(t.totalTokensSaved, 30);
  assert.ok(Math.abs(t.totalEnergyWh - 0.03) < 1e-9);
  // Running it again on the same map gives the same totals (idempotent).
  const t2 = M.recomputeSavingsTotals(t.daily);
  assert.strictEqual(t2.totalTokensSaved, 30);
});

test('full claim re-run is a no-op: push->pull->push yields the same daily state and totals', () => {
  // Simulate the migration/claim running twice. The "server" is the daily map;
  // pushing overwrites by day, pulling merges. Totals must not grow.
  const localDaily = { '2026-06-30': { count: 4, tokens: 40, energyWh: 0.04, waterMl: 0.2, co2G: 0.02 } };
  const asRemote = (d) => Object.entries(d).map(([day, b]) => ({
    day, count: b.count, tokens: b.tokens, energy_wh: b.energyWh, water_ml: b.waterMl, co2_g: b.co2G,
  }));
  const round1 = M.mergeSavingsDaily(localDaily, asRemote(localDaily));
  const round2 = M.mergeSavingsDaily(round1, asRemote(round1));
  assert.strictEqual(M.recomputeSavingsTotals(round2).totalTokensSaved, 40);
});

test('dedupeUpsertRows keeps one row per conflict key (last wins)', () => {
  const rows = [{ day: 'd', v: 1 }, { day: 'd', v: 2 }, { day: 'e', v: 3 }];
  const out = M.dedupeUpsertRows(rows, (r) => r.day);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out.find((r) => r.day === 'd').v, 2);
});
