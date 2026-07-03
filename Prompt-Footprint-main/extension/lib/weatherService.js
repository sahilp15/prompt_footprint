// PromptFootprint weather / location service.
//
// Estimates the weather near the data-center region most likely to be serving
// AI requests, so the heatwave overlay can contextualize the impact. Two hard
// honesty constraints:
//   1. We do NOT know the exact data center handling a given Gemini/OpenAI/
//      Claude request — routing isn't exposed. So we map the user's location to
//      the NEAREST KNOWN CLOUD REGION and label everything an APPROXIMATION.
//   2. Location is optional. The caller may pass precise coords (with consent),
//      a manually geocoded city/ZIP, or nothing (general estimate).
//
// Weather comes from Open-Meteo — a free, no-API-key, CORS-enabled service.
// Pure helpers (region lookup, URL builders, parsers) are unit-tested; the fetch
// wrappers are thin. Runs as a content-script/dashboard global and under Node.

(function (root) {
  'use strict';

  const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
  const OPEN_METEO_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

  // A small, static table of major public-cloud regions (the big three's busiest
  // AI regions). This is a PROXY for "where compute likely runs", not a claim
  // about any specific request's routing. lat/lon are approximate region cities.
  const CLOUD_REGIONS = [
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

  function toRad(d) { return (d * Math.PI) / 180; }

  // Great-circle distance in km between two {lat, lon} points.
  function haversineKm(a, b) {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Nearest known cloud region to a coordinate. Returns { ...region, distanceKm }
  // or null for invalid input.
  function nearestCloudRegion(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) return null;
    let best = null;
    for (const r of CLOUD_REGIONS) {
      const d = haversineKm({ lat, lon }, r);
      if (!best || d < best.distanceKm) best = { ...r, distanceKm: d };
    }
    return best;
  }

  // Round a coordinate for storage/requests (~11 km at 1 dp) so we never keep a
  // precise location. Default 1 decimal place.
  function coarsenCoord(n, dp) {
    const p = Math.pow(10, dp == null ? 1 : dp);
    return Math.round(n * p) / p;
  }

  function buildForecastUrl(lat, lon) {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code',
      daily: 'temperature_2m_max,apparent_temperature_max',
      timezone: 'auto',
      forecast_days: '1',
    });
    return `${OPEN_METEO_FORECAST}?${params.toString()}`;
  }

  function buildGeocodeUrl(query) {
    const params = new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' });
    return `${OPEN_METEO_GEOCODE}?${params.toString()}`;
  }

  // Parse an Open-Meteo forecast response into a compact, storable weather object.
  // Prefers apparent temperature (heat index) when present.
  function parseForecast(json) {
    if (!json || typeof json !== 'object') return null;
    const cur = json.current || {};
    const daily = json.daily || {};
    const tempC = typeof cur.temperature_2m === 'number' ? cur.temperature_2m : null;
    const apparentC = typeof cur.apparent_temperature === 'number' ? cur.apparent_temperature : null;
    if (tempC == null && apparentC == null) return null;
    const dailyMax = Array.isArray(daily.apparent_temperature_max) ? daily.apparent_temperature_max[0]
      : (Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null);
    return {
      tempC,
      apparentC,
      humidity: typeof cur.relative_humidity_2m === 'number' ? cur.relative_humidity_2m : null,
      dailyMaxC: typeof dailyMax === 'number' ? dailyMax : null,
      // The temperature we drive the heat overlay with: heat index if available.
      feelsLikeC: apparentC != null ? apparentC : tempC,
    };
  }

  function parseGeocode(json) {
    if (!json || !Array.isArray(json.results) || !json.results.length) return null;
    const r = json.results[0];
    if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
    const parts = [r.name, r.admin1, r.country].filter(Boolean);
    return { name: parts.join(', '), lat: r.latitude, lon: r.longitude };
  }

  // ── Thin fetch wrappers (impure) ──────────────────────────────────────────
  async function fetchWeather(lat, lon, fetchImpl) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('no fetch available');
    const res = await f(buildForecastUrl(lat, lon));
    if (!res.ok) throw new Error(`weather ${res.status}`);
    return parseForecast(await res.json());
  }

  async function geocode(query, fetchImpl) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('no fetch available');
    const res = await f(buildGeocodeUrl(query));
    if (!res.ok) throw new Error(`geocode ${res.status}`);
    return parseGeocode(await res.json());
  }

  const PFWeather = {
    CLOUD_REGIONS,
    OPEN_METEO_FORECAST,
    OPEN_METEO_GEOCODE,
    haversineKm,
    nearestCloudRegion,
    coarsenCoord,
    buildForecastUrl,
    buildGeocodeUrl,
    parseForecast,
    parseGeocode,
    fetchWeather,
    geocode,
  };

  if (root) root.PFWeather = PFWeather;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFWeather;
})(typeof self !== 'undefined' ? self : this);
