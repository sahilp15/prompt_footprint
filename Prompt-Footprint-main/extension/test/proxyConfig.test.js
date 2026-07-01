const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/proxyConfig.js');

test('resolveWritingProvider is local when nothing is configured', () => {
  assert.strictEqual(P.resolveWritingProvider({}), 'local');
  assert.strictEqual(P.resolveWritingProvider(null), 'local');
  assert.strictEqual(P.resolveWritingProvider({ proxyUrl: '', geminiApiKey: '' }), 'local');
});

test('resolveWritingProvider is gemini when a valid proxy URL override is set', () => {
  assert.strictEqual(P.resolveWritingProvider({ proxyUrl: 'https://x.workers.dev' }), 'gemini');
});

test('resolveWritingProvider is gemini when an advanced user key is set', () => {
  assert.strictEqual(P.resolveWritingProvider({ geminiApiKey: 'AIza-xyz' }), 'gemini');
});

test('resolveProxyUrl prefers a valid override, ignores junk, falls back to default', () => {
  assert.strictEqual(P.resolveProxyUrl({ proxyUrl: 'https://a.workers.dev' }), 'https://a.workers.dev');
  assert.strictEqual(P.resolveProxyUrl({ proxyUrl: 'not-a-url' }), P.PF_PROXY_URL);
  assert.strictEqual(P.resolveProxyUrl({ proxyUrl: 'http://insecure.com' }), P.PF_PROXY_URL); // https only
  assert.strictEqual(P.resolveProxyUrl({}), P.PF_PROXY_URL);
});

test('isHttpUrl accepts https only', () => {
  assert.strictEqual(P.isHttpUrl('https://x.dev'), true);
  assert.strictEqual(P.isHttpUrl('http://x.dev'), false);
  assert.strictEqual(P.isHttpUrl('ftp://x'), false);
  assert.strictEqual(P.isHttpUrl(''), false);
  assert.strictEqual(P.isHttpUrl(null), false);
});

// Gemini-failure / bad-data graceful fallback: pickField must never throw and
// must yield '' for anything that isn't a clean string, so the content script
// falls back to local-only suggestions instead of breaking.
test('pickField extracts a string field safely', () => {
  assert.strictEqual(P.pickField({ improved: '  hi ' }, 'improved'), 'hi');
  assert.strictEqual(P.pickField({ rewritten: 'x' }, 'rewritten'), 'x');
});

test('pickField returns empty string for malformed / rate-limited responses', () => {
  assert.strictEqual(P.pickField(null, 'improved'), '');
  assert.strictEqual(P.pickField(undefined, 'improved'), '');
  assert.strictEqual(P.pickField('a string', 'improved'), '');
  assert.strictEqual(P.pickField({ error: 'Rate limit exceeded' }, 'improved'), '');
  assert.strictEqual(P.pickField({ improved: 42 }, 'improved'), '');
  assert.strictEqual(P.pickField({ improved: { x: 1 } }, 'improved'), '');
});
