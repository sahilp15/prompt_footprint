const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/syncPayload.js');

// A realistic chrome.storage.local snapshot: settings with a SECRET Gemini key
// and a proxy URL, UI positions, and a session whose queries carry (hypothetical)
// text. The builder must exclude every one of these.
function snapshot() {
  return {
    pf_userId: 'user-abc',
    pf_config: {
      overlayEnabled: false,
      writingChecksEnabled: true,
      energyPerTokenMultiplier: 2.5,
      debug: true,
      proxyUrl: 'https://secret-proxy.workers.dev/api',
      geminiApiKey: 'AIzaSUPERSECRETKEY123',
    },
    pf_capsule_pos: { left: 42, top: 99 },
    pf_optimizer_pos: { left: 1, top: 2 },
    pf_savings: {
      applyCount: 3,
      totalTokensSaved: 30,
      daily: { '2026-06-30': { count: 3, tokens: 30, energyWh: 0.03, waterMl: 0.1, co2G: 0.01 } },
    },
    'pf_session_11111111-1111-1111-1111-111111111111': {
      id: '11111111-1111-1111-1111-111111111111',
      userId: 'user-abc',
      platform: 'chatgpt',
      startTime: '2026-06-30T10:00:00.000Z',
      endTime: '2026-06-30T10:05:00.000Z',
      totalTokens: 400,
      totalEnergyWh: 0.42,
      totalWaterMl: 1.4,
      totalCo2G: 0.15,
      totalResponseTimeMs: 8000,
      queryCount: 2,
      queries: [
        { id: 'q1', promptTokens: 100, responseTokens: 100, rawPrompt: 'MY SECRET PROMPT TEXT' },
      ],
    },
  };
}

test('sync payload NEVER includes raw text, the Gemini key, the proxy URL, or UI positions', () => {
  const payload = P.buildSyncPayload(snapshot(), 'auth-user-1');
  const json = JSON.stringify(payload);
  assert.ok(!json.includes('AIzaSUPERSECRETKEY123'), 'Gemini key must not be in the payload');
  assert.ok(!json.includes('secret-proxy.workers.dev'), 'proxy URL must not be in the payload');
  assert.ok(!json.includes('MY SECRET PROMPT TEXT'), 'prompt text must not be in the payload');
  assert.ok(!json.includes('queries'), 'per-query array must not be in the payload');
  assert.ok(!json.includes('capsule'), 'UI positions must not be in the payload');
});

test('session rows carry ONLY the whitelisted numeric/enum fields', () => {
  const payload = P.buildSyncPayload(snapshot(), 'auth-user-1');
  assert.strictEqual(payload.sessions.length, 1);
  const row = payload.sessions[0];
  const expected = new Set(['user_id', ...P.SESSION_FIELDS]);
  assert.deepStrictEqual(new Set(Object.keys(row)), expected);
  assert.strictEqual(row.user_id, 'auth-user-1');
  assert.strictEqual(row.session_id, '11111111-1111-1111-1111-111111111111');
  assert.strictEqual(row.platform, 'chatgpt');
  assert.strictEqual(row.total_tokens, 400);
  assert.strictEqual(row.query_count, 2);
});

test('settings row carries only non-sensitive fields (no key, no proxy, no debug)', () => {
  const payload = P.buildSyncPayload(snapshot(), 'auth-user-1');
  assert.deepStrictEqual(new Set(Object.keys(payload.settings)),
    new Set(['user_id', ...P.SETTINGS_FIELDS]));
  assert.strictEqual(payload.settings.overlay_enabled, false);
  assert.strictEqual(payload.settings.writing_checks_enabled, true);
  assert.strictEqual(payload.settings.energy_per_token_multiplier, 2.5);
});

test('savings rows map the daily bucket by day', () => {
  const payload = P.buildSyncPayload(snapshot(), 'auth-user-1');
  assert.strictEqual(payload.savingsDaily.length, 1);
  const r = payload.savingsDaily[0];
  assert.strictEqual(r.user_id, 'auth-user-1');
  assert.strictEqual(r.day, '2026-06-30');
  assert.strictEqual(r.tokens, 30);
  assert.strictEqual(r.count, 3);
});

test('unknown platforms are coerced to the enum default', () => {
  const snap = snapshot();
  snap['pf_session_22222222-2222-2222-2222-222222222222'] = {
    id: '22222222-2222-2222-2222-222222222222', platform: 'bard', startTime: 'x', queryCount: 0,
  };
  const payload = P.buildSyncPayload(snap, 'auth-user-1');
  const bad = payload.sessions.find((s) => s.session_id.startsWith('2222'));
  assert.strictEqual(bad.platform, 'unknown');
});

test('empty/blank snapshot yields empty rows and default settings (no crash)', () => {
  const payload = P.buildSyncPayload({}, 'auth-user-1');
  assert.deepStrictEqual(payload.sessions, []);
  assert.deepStrictEqual(payload.savingsDaily, []);
  assert.strictEqual(payload.settings.overlay_enabled, true);
  assert.strictEqual(payload.settings.energy_per_token_multiplier, 1.0);
});
