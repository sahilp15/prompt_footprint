const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/constants.js');
const { estimateQueryTokens } = require('../lib/tokenEstimator.js');
const M = require('../lib/environmentalModel.js');

const PROMPT = 'Write a short function to reverse a string in JavaScript';
const RESPONSE = 'function reverse(s){ return s.split("").reverse().join(""); }';

test('ChatGPT regression: no response time == original token-only model', () => {
  const { totalTokens } = estimateQueryTokens(PROMPT, RESPONSE);
  const r = M.calculateQueryImpact(PROMPT, RESPONSE, { platform: 'chatgpt' });
  assert.strictEqual(r.timeFactor, 1);
  assert.ok(Math.abs(r.energyWh - totalTokens * C.ENERGY_PER_TOKEN_WH) < 1e-12);
  assert.ok(Math.abs(r.waterMl - totalTokens * C.WATER_PER_TOKEN_ML) < 1e-12);
  assert.ok(Math.abs(r.co2G - totalTokens * C.CO2_PER_TOKEN_G) < 1e-12);
});

test('legacy numeric multiplier signature still works (chatgpt)', () => {
  const a = M.calculateQueryImpact(PROMPT, RESPONSE, 2.0);
  const b = M.calculateQueryImpact(PROMPT, RESPONSE, { platform: 'chatgpt', multiplier: 2.0 });
  assert.strictEqual(a.energyWh, b.energyWh);
  assert.strictEqual(a.platform, 'chatgpt');
});

test('slow response raises timeFactor above 1 and increases energy', () => {
  const base = M.calculateQueryImpact(PROMPT, RESPONSE, { platform: 'chatgpt' });
  const slow = M.calculateQueryImpact(PROMPT, RESPONSE, { platform: 'chatgpt', responseTimeMs: 60000 });
  assert.ok(slow.timeFactor > 1);
  assert.ok(slow.energyWh > base.energyWh);
});

test('timeFactor is capped', () => {
  const r = M.calculateQueryImpact(PROMPT, RESPONSE, { platform: 'chatgpt', responseTimeMs: 10_000_000 });
  assert.strictEqual(r.timeFactor, C.RESPONSE_TIME_MODEL.TIME_FACTOR_CAP);
});

test('sub-threshold response time => no adjustment (factor 1)', () => {
  const r = M.calculateQueryImpact(PROMPT, RESPONSE, { platform: 'chatgpt', responseTimeMs: 100 });
  assert.strictEqual(r.timeFactor, 1);
});

test('Claude profile scales intensity by CLAUDE_RELATIVE_INTENSITY', () => {
  const gpt = M.calculateQueryImpact(PROMPT, RESPONSE, { platform: 'chatgpt' });
  const cl = M.calculateQueryImpact(PROMPT, RESPONSE, { platform: 'claude' });
  assert.strictEqual(cl.platform, 'claude');
  const ratio = cl.energyWh / gpt.energyWh;
  assert.ok(Math.abs(ratio - C.CLAUDE_RELATIVE_INTENSITY) < 1e-9);
});

test('unknown platform falls back to chatgpt profile', () => {
  const fallback = M.calculateQueryImpact(PROMPT, RESPONSE, { platform: 'nope' });
  const gpt = M.calculateQueryImpact(PROMPT, RESPONSE, { platform: 'chatgpt' });
  assert.strictEqual(fallback.energyWh, gpt.energyWh);
});

test('computeTimeFactor: faster-than-baseline clamps to 1', () => {
  // 100 tokens in 0.5s = 200 tok/s, well above any baseline => floor 1
  assert.strictEqual(M.computeTimeFactor(100, 500, 55), 1);
});
