// Environmental impact calculator
// Converts token counts (and response time) to energy (Wh), water (mL), and
// CO2 (g) estimates, per platform.
//
// MODEL
//   base   = totalTokens × profile.{energy,water,co2}PerToken × userMultiplier
//   impact = base × timeFactor
//
//   timeFactor scales the estimate UP for responses that stream slower than the
//   platform's baseline throughput — a proxy for heavier per-token compute
//   (reasoning, server load). The token estimate is always the FLOOR; fast
//   responses are never scaled below 1×. When no response time is supplied,
//   timeFactor = 1, so results match the original token-only model exactly
//   (ChatGPT figures are preserved).
//
//   LIMITATION: measured response time includes network/queue/time-to-first-
//   token, not just GPU work. timeFactor is therefore a bounded heuristic
//   (capped by RESPONSE_TIME_MODEL.TIME_FACTOR_CAP), not a physical measurement.
//
// This file runs both as a content-script global (constants/tokenEstimator are
// loaded first and live in the shared lexical scope) and under Node for tests
// (where it requires its dependencies).

const _C = (typeof PLATFORM_PROFILES !== 'undefined')
  ? { PLATFORM_PROFILES, RESPONSE_TIME_MODEL, HEATWAVE_MODEL }
  : require('./constants.js');
const _T = (typeof estimateQueryTokens !== 'undefined')
  ? { estimateQueryTokens }
  : require('./tokenEstimator.js');

function _clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

// Accept a legacy numeric multiplier OR an options object.
function _normalizeOptions(options) {
  if (typeof options === 'number') {
    return { platform: 'chatgpt', multiplier: options, responseTimeMs: 0 };
  }
  const o = options || {};
  return {
    platform: o.platform || 'chatgpt',
    multiplier: typeof o.multiplier === 'number' ? o.multiplier : 1.0,
    responseTimeMs: o.responseTimeMs || 0,
  };
}

function resolveProfile(platform) {
  return _C.PLATFORM_PROFILES[platform] || _C.PLATFORM_PROFILES.chatgpt;
}

// timeFactor >= 1, capped. Slower-than-baseline throughput => larger factor.
function computeTimeFactor(responseTokens, responseTimeMs, baselineTokensPerSec) {
  const m = _C.RESPONSE_TIME_MODEL;
  if (!responseTimeMs || responseTimeMs <= 0 || !responseTokens || !baselineTokensPerSec) {
    return 1;
  }
  const sec = responseTimeMs / 1000;
  // Sub-threshold durations are dominated by network/measurement noise — too
  // unreliable to adjust on, so leave the estimate at the token-only floor.
  if (sec < m.MIN_RESPONSE_SEC) return 1;
  const observedTokensPerSec = responseTokens / sec;
  if (observedTokensPerSec <= 0) return 1;
  const factor = baselineTokensPerSec / observedTokensPerSec;
  return _clamp(factor, 1, m.TIME_FACTOR_CAP);
}

function calculateImpact(totalTokens, options) {
  const opts = _normalizeOptions(options);
  const profile = resolveProfile(opts.platform);
  const m = opts.multiplier;
  return {
    energyWh: totalTokens * profile.energyPerTokenWh * m,
    waterMl: totalTokens * profile.waterPerTokenMl * m,
    co2G: totalTokens * profile.co2PerTokenG * m,
  };
}

function calculateQueryImpact(promptText, responseText, options) {
  const opts = _normalizeOptions(options);
  const profile = resolveProfile(opts.platform);
  const { promptTokens, responseTokens, totalTokens } = _T.estimateQueryTokens(promptText, responseText);
  const timeFactor = computeTimeFactor(responseTokens, opts.responseTimeMs, profile.baselineTokensPerSec);
  const m = opts.multiplier * timeFactor;

  return {
    promptTokens,
    responseTokens,
    totalTokens,
    platform: profile.id,
    responseTimeMs: opts.responseTimeMs || 0,
    timeFactor,
    energyWh: totalTokens * profile.energyPerTokenWh * m,
    waterMl: totalTokens * profile.waterPerTokenMl * m,
    co2G: totalTokens * profile.co2PerTokenG * m,
  };
}

// ── Heatwave overlay (contextual, display-only) ────────────────────────────--
// These NEVER change the stored/base impact. They compute how much higher
// cooling-driven energy/water/CO2 could run right now given nearby weather,
// relative to the annualized PUE already baked into the base numbers. It is an
// APPROXIMATION using the nearest known cloud region as a proxy — we do not
// claim to know the exact data center serving a request.

// Peak PUE rises with ambient heat: a linear ramp from the annualized PUE at
// BASE_TEMP_C to PEAK_PUE at PEAK_TEMP_C.
function heatwavePeakPue(tempC) {
  const h = _C.HEATWAVE_MODEL;
  if (typeof tempC !== 'number' || Number.isNaN(tempC)) return h.ANNUAL_PUE;
  if (tempC <= h.BASE_TEMP_C) return h.ANNUAL_PUE;
  if (tempC >= h.PEAK_TEMP_C) return h.PEAK_PUE;
  const frac = (tempC - h.BASE_TEMP_C) / (h.PEAK_TEMP_C - h.BASE_TEMP_C);
  return h.ANNUAL_PUE + frac * (h.PEAK_PUE - h.ANNUAL_PUE);
}

// Contextual heat factor (>= 1): peakPUE(temp) / annualPUE.
function heatwaveFactor(tempC) {
  return heatwavePeakPue(tempC) / _C.HEATWAVE_MODEL.ANNUAL_PUE;
}

// Apply the overlay to a base impact ({ energyWh, waterMl, co2G }). Returns the
// adjusted figures plus the factor, the modeled peak PUE, and whether the
// weather qualifies as a heatwave context. tempC null/absent => factor 1 (no-op).
function applyHeatwaveContext(base, opts) {
  const o = opts || {};
  const tempC = typeof o.tempC === 'number' ? o.tempC : null;
  const factor = tempC == null ? 1 : heatwaveFactor(tempC);
  const b = base || {};
  return {
    factor,
    peakPue: tempC == null ? _C.HEATWAVE_MODEL.ANNUAL_PUE : heatwavePeakPue(tempC),
    isHeatwave: tempC != null && tempC >= _C.HEATWAVE_MODEL.HEATWAVE_TEMP_C && factor > 1.001,
    energyWh: (b.energyWh || 0) * factor,
    waterMl: (b.waterMl || 0) * factor,
    co2G: (b.co2G || 0) * factor,
  };
}

function getMultiplierForLevel(reasoningLevel) {
  const r = (typeof REASONING_MULTIPLIERS !== 'undefined')
    ? REASONING_MULTIPLIERS
    : require('./constants.js').REASONING_MULTIPLIERS;
  return r[reasoningLevel] || r.none;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calculateImpact, calculateQueryImpact, getMultiplierForLevel, computeTimeFactor, resolveProfile, heatwavePeakPue, heatwaveFactor, applyHeatwaveContext };
}
