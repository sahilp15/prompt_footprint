const test = require('node:test');
const assert = require('node:assert');
const M = require('../lib/environmentalModel.js');
const C = require('../lib/constants.js');
const W = require('../lib/weatherService.js');

// ── Heatwave PUE overlay ────────────────────────────────────────────────────

test('heatwavePeakPue is flat below base temp and clamps at peak temp', () => {
  const h = C.HEATWAVE_MODEL;
  assert.strictEqual(M.heatwavePeakPue(10), h.ANNUAL_PUE);
  assert.strictEqual(M.heatwavePeakPue(h.BASE_TEMP_C), h.ANNUAL_PUE);
  assert.strictEqual(M.heatwavePeakPue(h.PEAK_TEMP_C), h.PEAK_PUE);
  assert.strictEqual(M.heatwavePeakPue(100), h.PEAK_PUE); // clamped
});

test('heatwavePeakPue ramps linearly between base and peak', () => {
  const h = C.HEATWAVE_MODEL; // 25 -> 40, 1.1 -> 1.4
  const mid = (h.BASE_TEMP_C + h.PEAK_TEMP_C) / 2; // 32.5
  const expected = h.ANNUAL_PUE + 0.5 * (h.PEAK_PUE - h.ANNUAL_PUE); // 1.25
  assert.ok(Math.abs(M.heatwavePeakPue(mid) - expected) < 1e-9);
});

test('heatwaveFactor is 1.0 in mild weather and ~1.27 in extreme heat', () => {
  assert.strictEqual(M.heatwaveFactor(20), 1);
  const extreme = M.heatwaveFactor(40); // 1.4 / 1.1
  assert.ok(Math.abs(extreme - 1.4 / 1.1) < 1e-9);
  assert.ok(extreme > 1.27 && extreme < 1.28);
});

test('non-numeric temperature is a no-op (factor 1)', () => {
  assert.strictEqual(M.heatwaveFactor(NaN), 1);
  assert.strictEqual(M.heatwavePeakPue(undefined), C.HEATWAVE_MODEL.ANNUAL_PUE);
});

test('applyHeatwaveContext scales a base impact and flags a heatwave', () => {
  const base = { energyWh: 100, waterMl: 200, co2G: 50 };
  const mild = M.applyHeatwaveContext(base, { tempC: 18 });
  assert.strictEqual(mild.factor, 1);
  assert.strictEqual(mild.isHeatwave, false);
  assert.strictEqual(mild.energyWh, 100);

  const hot = M.applyHeatwaveContext(base, { tempC: 38 });
  assert.ok(hot.factor > 1);
  assert.strictEqual(hot.isHeatwave, true);
  assert.ok(Math.abs(hot.energyWh - 100 * hot.factor) < 1e-9);
  assert.ok(Math.abs(hot.waterMl - 200 * hot.factor) < 1e-9);
  assert.ok(Math.abs(hot.co2G - 50 * hot.factor) < 1e-9);
});

test('applyHeatwaveContext with no temperature leaves the base untouched', () => {
  const base = { energyWh: 10, waterMl: 20, co2G: 5 };
  const r = M.applyHeatwaveContext(base, {});
  assert.deepStrictEqual(
    { e: r.energyWh, w: r.waterMl, c: r.co2G, f: r.factor },
    { e: 10, w: 20, c: 5, f: 1 }
  );
});

test('the heat overlay never mutates the base tracking numbers', () => {
  // calculateQueryImpact must be unaffected by the overlay existing.
  const r = M.calculateQueryImpact('hello world', 'a response here', { platform: 'chatgpt' });
  assert.ok(r.energyWh > 0);
  assert.strictEqual(r.timeFactor, 1); // unchanged behavior
});

// ── Nearest cloud region + weather parsing ──────────────────────────────────

test('nearestCloudRegion picks the closest known region', () => {
  // Near London.
  const london = W.nearestCloudRegion(51.5, -0.12);
  assert.strictEqual(london.id, 'eu-west-london');
  assert.ok(london.distanceKm < 50);
  // Near Los Angeles -> N. California is the closest US West option.
  const la = W.nearestCloudRegion(34.05, -118.24);
  assert.ok(['us-west-cali'].includes(la.id));
});

test('nearestCloudRegion rejects invalid coordinates', () => {
  assert.strictEqual(W.nearestCloudRegion(NaN, 0), null);
  assert.strictEqual(W.nearestCloudRegion('x', 'y'), null);
});

test('coarsenCoord drops precision so we never store an exact location', () => {
  assert.strictEqual(W.coarsenCoord(51.50735, 1), 51.5);
  assert.strictEqual(W.coarsenCoord(-0.12776, 1), -0.1);
});

test('buildForecastUrl and buildGeocodeUrl hit Open-Meteo with no API key', () => {
  const fu = W.buildForecastUrl(51.5, -0.1);
  assert.ok(fu.startsWith('https://api.open-meteo.com/v1/forecast'));
  assert.ok(fu.includes('apparent_temperature'));
  assert.ok(!/key=|apikey|token/i.test(fu), 'no API key should ever be in the URL');
  const gu = W.buildGeocodeUrl('Riverside');
  assert.ok(gu.startsWith('https://geocoding-api.open-meteo.com/v1/search'));
  assert.ok(gu.includes('name=Riverside'));
});

test('parseForecast prefers apparent temperature (heat index) as feels-like', () => {
  const w = W.parseForecast({
    current: { temperature_2m: 36, apparent_temperature: 41, relative_humidity_2m: 55 },
    daily: { apparent_temperature_max: [43], temperature_2m_max: [38] },
  });
  assert.strictEqual(w.tempC, 36);
  assert.strictEqual(w.apparentC, 41);
  assert.strictEqual(w.feelsLikeC, 41);
  assert.strictEqual(w.dailyMaxC, 43);
});

test('parseForecast/parseGeocode return null on empty input', () => {
  assert.strictEqual(W.parseForecast(null), null);
  assert.strictEqual(W.parseForecast({ current: {} }), null);
  assert.strictEqual(W.parseGeocode({ results: [] }), null);
  const g = W.parseGeocode({ results: [{ name: 'Riverside', admin1: 'California', country: 'United States', latitude: 33.95, longitude: -117.4 }] });
  assert.strictEqual(g.name, 'Riverside, California, United States');
  assert.strictEqual(g.lat, 33.95);
});

test('fetchWeather uses an injected fetch and returns parsed weather', async () => {
  const fakeFetch = async (url) => {
    assert.ok(url.includes('api.open-meteo.com'));
    return { ok: true, json: async () => ({ current: { temperature_2m: 30, apparent_temperature: 33 } }) };
  };
  const w = await W.fetchWeather(33.9, -117.4, fakeFetch);
  assert.strictEqual(w.feelsLikeC, 33);
});
