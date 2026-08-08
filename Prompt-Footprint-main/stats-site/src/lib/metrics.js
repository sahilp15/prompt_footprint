// Presentation helpers shared by the analytics pages.
//
// Nothing here changes what is measured — it only decides how a number is
// written down, how two periods compare, and what a figure feels like in
// everyday terms. The equivalence factors are deliberately round, widely
// published numbers, and every surface that uses them labels them as
// approximations.

/** Adaptive precision: keep small values informative, large ones readable. */
export function formatValue(value, { maxDecimals = 3 } = {}) {
  const v = Number(value) || 0;
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1000) return Math.round(v).toLocaleString();
  if (abs >= 100) return v.toFixed(Math.min(1, maxDecimals));
  if (abs >= 1) return v.toFixed(Math.min(2, maxDecimals));
  if (abs >= 0.01) return v.toFixed(Math.min(3, maxDecimals));
  return v.toFixed(maxDecimals + 2);
}

/** Short form for axis ticks and dense chips: 1.2k, 18.4k, 2.1M. */
export function formatCompact(value) {
  const v = Number(value) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (abs >= 10) return String(Math.round(v));
  if (abs >= 1) return v.toFixed(1);
  if (abs === 0) return '0';
  return v.toFixed(2);
}

/**
 * Percentage change from `previous` to `current`.
 *
 * Returns `null` when there is no prior period to compare against — a first
 * week is not a "+100% increase", it is simply the baseline, and the UI says
 * so rather than inventing a delta.
 */
export function changeVs(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (before <= 0) return null;
  const pct = ((now - before) / before) * 100;
  // Anything under half a percent reads as unchanged.
  if (Math.abs(pct) < 0.5) return { pct: 0, direction: 'flat' };
  return { pct, direction: pct > 0 ? 'up' : 'down' };
}

// ── Everyday equivalents ──────────────────────────────────────────────────
// Rounded reference figures:
//   LED bulb          9 W
//   Laptop           50 W
//   Drinking glass   250 mL
//   Average car      120 g CO₂ per km
const LED_WATTS = 9;
const LAPTOP_WATTS = 50;
const GLASS_ML = 250;
const CAR_G_PER_KM = 120;

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function minutesLabel(minutes) {
  if (minutes >= 90) {
    const hours = minutes / 60;
    return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hours`;
  }
  if (minutes >= 1) return plural(Math.round(minutes), 'minute', 'minutes');
  return plural(Math.max(1, Math.round(minutes * 60)), 'second', 'seconds');
}

function distanceLabel(metres) {
  if (metres >= 1000) {
    const km = metres / 1000;
    return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
  }
  return `${Math.max(1, Math.round(metres))} m`;
}

/**
 * Turn a footprint into four tangible comparisons. Every entry carries the
 * assumption it rests on so the dashboard can show its working.
 */
export function equivalents({ energyWh = 0, waterMl = 0, co2G = 0 }) {
  const bulbMinutes = (energyWh / LED_WATTS) * 60;
  const laptopMinutes = (energyWh / LAPTOP_WATTS) * 60;
  const glasses = waterMl / GLASS_ML;
  const metres = co2G / (CAR_G_PER_KM / 1000);

  return [
    {
      id: 'bulb',
      metric: 'energy',
      value: minutesLabel(bulbMinutes),
      label: 'of a 9 W LED bulb',
      basis: 'A typical LED bulb draws about 9 watts.',
    },
    {
      id: 'laptop',
      metric: 'energy',
      value: minutesLabel(laptopMinutes),
      label: 'of laptop use',
      basis: 'A laptop under normal load draws roughly 50 watts.',
    },
    {
      id: 'glass',
      metric: 'water',
      value: glasses >= 1 ? `${glasses.toFixed(1)}×` : `${Math.round(glasses * 100)}%`,
      label: glasses >= 1 ? 'a 250 mL glass of water' : 'of a 250 mL glass of water',
      basis: 'Fresh water evaporated for cooling, against a standard drinking glass.',
    },
    {
      id: 'drive',
      metric: 'carbon',
      value: distanceLabel(metres),
      label: 'driven in an average car',
      basis: 'An average passenger car emits about 120 g of CO₂ per kilometre.',
    },
  ];
}

/** The heaviest day in a daily series, for the "busiest day" callout. */
export function peakDay(daily, key = 'energyWh') {
  if (!Array.isArray(daily) || daily.length === 0) return null;
  return daily.reduce((best, d) => ((d?.[key] || 0) > (best?.[key] || 0) ? d : best), daily[0]);
}

/** True when a period has nothing in it at all. */
export function isEmptyPeriod(totals) {
  if (!totals) return true;
  return !(totals.totalTokens || totals.queryCount || totals.sessionCount);
}
