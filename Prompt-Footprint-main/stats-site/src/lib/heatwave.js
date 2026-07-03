// Heatwave estimate helpers for the dashboard.
//
// This mirrors the extension's tested lib/weatherService.js + the heat overlay in
// lib/environmentalModel.js. The dashboard is a separate bundle and can't import
// the extension's scripts, so the numbers are duplicated here — keep them in sync
// with the extension (that copy is the unit-tested source of truth).
//
// Honesty constraints: exact request routing is unknown, so we map a location to
// the NEAREST KNOWN CLOUD REGION and label everything an approximation. Weather
// comes from Open-Meteo (free, no API key). Location is always optional.

export const HEATWAVE_MODEL = {
  ANNUAL_PUE: 1.1,
  BASE_TEMP_C: 25,
  PEAK_TEMP_C: 40,
  PEAK_PUE: 1.4,
  HEATWAVE_TEMP_C: 32,
};

export const CLOUD_REGIONS = [
  { id: 'us-east', label: 'US East (N. Virginia)', lat: 39.04, lon: -77.49 },
  { id: 'us-east-ohio', label: 'US East (Ohio)', lat: 40.42, lon: -82.91 },
  { id: 'us-central', label: 'US Central (Iowa)', lat: 41.26, lon: -95.86 },
  { id: 'us-west-oregon', label: 'US West (Oregon)', lat: 45.84, lon: -119.70 },
  { id: 'us-west-cali', label: 'US West (N. California)', lat: 37.78, lon: -122.42 },
  { id: 'us-south-texas', label: 'US South (Texas)', lat: 32.78, lon: -96.80 },
  { id: 'ca-central', label: 'Canada (Montréal)', lat: 45.50, lon: -73.57 },
  { id: 'sa-east', label: 'South America (São Paulo)', lat: -23.55, lon: -46.63 },
  { id: 'eu-west-ireland', label: 'Europe (Ireland)', lat: 53.35, lon: -6.26 },
  { id: 'eu-west-london', label: 'Europe (London)', lat: 51.51, lon: -0.13 },
  { id: 'eu-central-frankfurt', label: 'Europe (Frankfurt)', lat: 50.11, lon: 8.68 },
  { id: 'eu-north-stockholm', label: 'Europe (Stockholm)', lat: 59.33, lon: 18.07 },
  { id: 'me-central', label: 'Middle East (Dubai)', lat: 25.20, lon: 55.27 },
  { id: 'af-south', label: 'Africa (Cape Town)', lat: -33.92, lon: 18.42 },
  { id: 'ap-south-mumbai', label: 'Asia Pacific (Mumbai)', lat: 19.08, lon: 72.88 },
  { id: 'ap-southeast-singapore', label: 'Asia Pacific (Singapore)', lat: 1.35, lon: 103.82 },
  { id: 'ap-southeast-sydney', label: 'Asia Pacific (Sydney)', lat: -33.87, lon: 151.21 },
  { id: 'ap-northeast-tokyo', label: 'Asia Pacific (Tokyo)', lat: 35.68, lon: 139.69 },
  { id: 'ap-northeast-seoul', label: 'Asia Pacific (Seoul)', lat: 37.57, lon: 126.98 },
];

const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestCloudRegion(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  let best = null;
  for (const r of CLOUD_REGIONS) {
    const d = haversineKm({ lat, lon }, r);
    if (!best || d < best.distanceKm) best = { ...r, distanceKm: d };
  }
  return best;
}

export function coarsenCoord(n, dp = 1) {
  const p = Math.pow(10, dp);
  return Math.round(n * p) / p;
}

export function heatwavePeakPue(tempC) {
  const h = HEATWAVE_MODEL;
  if (typeof tempC !== 'number' || Number.isNaN(tempC)) return h.ANNUAL_PUE;
  if (tempC <= h.BASE_TEMP_C) return h.ANNUAL_PUE;
  if (tempC >= h.PEAK_TEMP_C) return h.PEAK_PUE;
  const frac = (tempC - h.BASE_TEMP_C) / (h.PEAK_TEMP_C - h.BASE_TEMP_C);
  return h.ANNUAL_PUE + frac * (h.PEAK_PUE - h.ANNUAL_PUE);
}

export function heatwaveFactor(tempC) {
  return heatwavePeakPue(tempC) / HEATWAVE_MODEL.ANNUAL_PUE;
}

export function isHeatwave(tempC) {
  return typeof tempC === 'number' && tempC >= HEATWAVE_MODEL.HEATWAVE_TEMP_C && heatwaveFactor(tempC) > 1.001;
}

const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

// Never let a slow/blocked request hang the UI on "Checking the weather…".
async function fetchJsonWithTimeout(url, ms = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildForecastUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code',
    daily: 'temperature_2m_max,apparent_temperature_max',
    timezone: 'auto', forecast_days: '1',
  });
  return `${OPEN_METEO_FORECAST}?${p.toString()}`;
}

function buildGeocodeUrl(query) {
  const p = new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' });
  return `${OPEN_METEO_GEOCODE}?${p.toString()}`;
}

export function parseForecast(json) {
  if (!json || typeof json !== 'object') return null;
  const cur = json.current || {};
  const daily = json.daily || {};
  const tempC = typeof cur.temperature_2m === 'number' ? cur.temperature_2m : null;
  const apparentC = typeof cur.apparent_temperature === 'number' ? cur.apparent_temperature : null;
  if (tempC == null && apparentC == null) return null;
  const dailyMax = Array.isArray(daily.apparent_temperature_max) ? daily.apparent_temperature_max[0]
    : (Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null);
  return {
    tempC, apparentC,
    humidity: typeof cur.relative_humidity_2m === 'number' ? cur.relative_humidity_2m : null,
    dailyMaxC: typeof dailyMax === 'number' ? dailyMax : null,
    feelsLikeC: apparentC != null ? apparentC : tempC,
  };
}

export async function fetchWeather(lat, lon) {
  return parseForecast(await fetchJsonWithTimeout(buildForecastUrl(lat, lon)));
}

export async function geocode(query) {
  const json = await fetchJsonWithTimeout(buildGeocodeUrl(query));
  if (!json || !Array.isArray(json.results) || !json.results.length) return null;
  const r = json.results[0];
  if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
  return { name: [r.name, r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude };
}
