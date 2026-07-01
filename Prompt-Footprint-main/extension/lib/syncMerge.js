// PromptFootprint — sync merge/dedup (PURE, no chrome, no network).
//
// Used when pulling a signed-in user's data back to the device. Every operation
// here is idempotent and commutative, so running sync any number of times (or
// on several devices) converges and NEVER double-counts:
//
//   * Sessions merge by session id; a re-seen session overwrites, never appends.
//   * Savings merge per calendar day by choosing the bucket with the larger
//     realized total (never summing across devices), so the same-day cross-device
//     case under-counts at worst and can never over-count.
//   * Running savings totals are always RECOMPUTED from the daily map, never
//     accumulated, so they can't drift.
//
// Remote rows use snake_case (supabase schema); local objects use camelCase
// (storage.js). Callers normalize remote sessions with normalizeRemoteSession
// before merging.
(function (root) {
  'use strict';

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  // session_stats row (snake_case) -> local pf_session object (camelCase).
  // Pulled sessions carry no per-query rows, so queries is empty.
  function normalizeRemoteSession(row, userId) {
    return {
      id: row.session_id,
      userId: userId || row.user_id,
      platform: row.platform || 'unknown',
      startTime: row.start_time || null,
      endTime: row.end_time || null,
      totalTokens: num(row.total_tokens),
      totalEnergyWh: num(row.total_energy_wh),
      totalWaterMl: num(row.total_water_ml),
      totalCo2G: num(row.total_co2_g),
      totalResponseTimeMs: num(row.total_response_time_ms),
      queryCount: num(row.query_count),
      queries: [],
    };
  }

  // Union two local-shaped session lists by id. On conflict keep the one with
  // the greater queryCount (monotonic as a session fills in); tie -> later
  // endTime. Idempotent: mergeSessions(a, a) deep-equals a.
  function mergeSessions(localList, remoteLocalList) {
    const byId = new Map();
    const consider = (s) => {
      if (!s || typeof s.id !== 'string') return;
      const cur = byId.get(s.id);
      if (!cur) { byId.set(s.id, s); return; }
      const better =
        num(s.queryCount) > num(cur.queryCount) ||
        (num(s.queryCount) === num(cur.queryCount) &&
          String(s.endTime || '') > String(cur.endTime || ''));
      if (better) byId.set(s.id, s);
    };
    (localList || []).forEach(consider);
    (remoteLocalList || []).forEach(consider);
    return Array.from(byId.values());
  }

  // savings_daily rows (snake_case) -> local daily map buckets (camelCase).
  function remoteSavingsToDaily(remoteRows) {
    const out = {};
    (remoteRows || []).forEach((r) => {
      if (!r || !r.day) return;
      out[r.day] = {
        count: num(r.count), tokens: num(r.tokens),
        energyWh: num(r.energy_wh), waterMl: num(r.water_ml), co2G: num(r.co2_g),
      };
    });
    return out;
  }

  // Merge two daily maps. Per day, keep the bucket with the larger realized
  // total (by tokens, tie by count) — commutative and idempotent, and it can
  // never over-count. Cross-device same-day realizations are not summed (a
  // documented trade-off), only the larger is kept.
  function mergeSavingsDaily(localDaily, remoteRows) {
    const remoteDaily = remoteSavingsToDaily(remoteRows);
    const merged = {};
    const days = new Set([...Object.keys(localDaily || {}), ...Object.keys(remoteDaily)]);
    for (const day of days) {
      const a = (localDaily && localDaily[day]) || null;
      const b = remoteDaily[day] || null;
      if (a && b) {
        const aBigger = num(a.tokens) > num(b.tokens) ||
          (num(a.tokens) === num(b.tokens) && num(a.count) >= num(b.count));
        merged[day] = aBigger ? a : b;
      } else {
        merged[day] = a || b;
      }
    }
    return merged;
  }

  // Recompute running savings totals from the daily map. Totals are ALWAYS
  // derived (never accumulated), which is what makes re-syncing safe.
  function recomputeSavingsTotals(dailyMap) {
    const totals = {
      applyCount: 0, totalTokensSaved: 0,
      totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0,
      daily: dailyMap || {},
    };
    for (const day of Object.keys(dailyMap || {})) {
      const b = dailyMap[day] || {};
      totals.applyCount += num(b.count);
      totals.totalTokensSaved += num(b.tokens);
      totals.totalEnergyWh += num(b.energyWh);
      totals.totalWaterMl += num(b.waterMl);
      totals.totalCo2G += num(b.co2G);
    }
    return totals;
  }

  // Collapse duplicate keys before a single Postgres upsert (which errors if one
  // statement touches the same conflict key twice), keeping the last occurrence.
  function dedupeUpsertRows(rows, keyFn) {
    const byKey = new Map();
    (rows || []).forEach((r) => byKey.set(keyFn(r), r));
    return Array.from(byKey.values());
  }

  const api = {
    normalizeRemoteSession, mergeSessions,
    remoteSavingsToDaily, mergeSavingsDaily, recomputeSavingsTotals,
    dedupeUpsertRows,
  };
  if (root) root.PFSyncMerge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
