// PromptFootprint — sync payload builder (PURE, no chrome, no network).
//
// Turns a chrome.storage.local snapshot (as returned by chrome.storage.local
// .get(null)) into the exact rows we upload for a signed-in user. It is
// WHITELIST-ONLY: it maps named fields into fresh objects and never copies a
// whole config/session/query object. That makes the privacy guarantee
// structural, not a filter that could be forgotten:
//
//   * Prompt/response text is never stored locally, and this builder never
//     touches the per-query array, so no text can be uploaded.
//   * geminiApiKey, proxyUrl, and UI positions are never read, so secrets and
//     device-local state never sync.
//
// Local key names mirror extension/lib/storage.js. DB column names are
// snake_case to match supabase/migrations/0001_init.sql.
(function (root) {
  'use strict';

  const CONFIG_KEY = 'pf_config';
  const SAVINGS_KEY = 'pf_savings';
  const SESSION_PREFIX = 'pf_session_';

  // Only these fields ever leave the device for a session (all numeric/enum,
  // never text).
  const SESSION_FIELDS = [
    'session_id', 'platform', 'start_time', 'end_time',
    'total_tokens', 'total_energy_wh', 'total_water_ml', 'total_co2_g',
    'total_response_time_ms', 'query_count',
  ];
  const SETTINGS_FIELDS = [
    'overlay_enabled', 'writing_checks_enabled', 'energy_per_token_multiplier',
  ];

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  // pf_session_* objects -> session_stats rows (numbers only).
  function extractSessions(snapshot, userId) {
    const out = [];
    if (!snapshot || typeof snapshot !== 'object') return out;
    for (const key of Object.keys(snapshot)) {
      if (!key.startsWith(SESSION_PREFIX)) continue;
      const s = snapshot[key];
      if (!s || typeof s !== 'object' || typeof s.id !== 'string') continue;
      const platform = (s.platform === 'chatgpt' || s.platform === 'claude') ? s.platform : 'unknown';
      out.push({
        user_id: userId,
        session_id: s.id,
        platform,
        start_time: s.startTime || null,
        end_time: s.endTime || null,
        total_tokens: num(s.totalTokens),
        total_energy_wh: num(s.totalEnergyWh),
        total_water_ml: num(s.totalWaterMl),
        total_co2_g: num(s.totalCo2G),
        total_response_time_ms: num(s.totalResponseTimeMs),
        query_count: num(s.queryCount),
      });
    }
    return out;
  }

  // pf_savings.daily map -> savings_daily rows keyed by day.
  function extractSavingsDaily(snapshot, userId) {
    const out = [];
    const daily = snapshot && snapshot[SAVINGS_KEY] && snapshot[SAVINGS_KEY].daily;
    if (!daily || typeof daily !== 'object') return out;
    for (const day of Object.keys(daily)) {
      const b = daily[day] || {};
      out.push({
        user_id: userId,
        day,
        count: num(b.count),
        tokens: num(b.tokens),
        energy_wh: num(b.energyWh),
        water_ml: num(b.waterMl),
        co2_g: num(b.co2G),
      });
    }
    return out;
  }

  // pf_config -> user_settings row (non-sensitive fields only).
  function extractSettings(snapshot, userId) {
    const c = (snapshot && snapshot[CONFIG_KEY]) || {};
    return {
      user_id: userId,
      overlay_enabled: c.overlayEnabled !== false,
      writing_checks_enabled: c.writingChecksEnabled !== false,
      energy_per_token_multiplier:
        typeof c.energyPerTokenMultiplier === 'number' && c.energyPerTokenMultiplier > 0
          ? c.energyPerTokenMultiplier : 1.0,
    };
  }

  function buildSyncPayload(snapshot, userId) {
    return {
      sessions: extractSessions(snapshot, userId),
      savingsDaily: extractSavingsDaily(snapshot, userId),
      settings: extractSettings(snapshot, userId),
    };
  }

  const api = {
    SESSION_FIELDS, SETTINGS_FIELDS,
    buildSyncPayload, extractSessions, extractSavingsDaily, extractSettings,
  };
  if (root) root.PFSyncPayload = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
