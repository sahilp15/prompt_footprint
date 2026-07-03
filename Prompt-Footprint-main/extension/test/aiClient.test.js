const test = require('node:test');
const assert = require('node:assert');
const A = require('../lib/aiClient.js');

test('classifyStatus maps HTTP status to a policy', () => {
  assert.strictEqual(A.classifyStatus(200), 'ok');
  assert.strictEqual(A.classifyStatus(204), 'ok');
  assert.strictEqual(A.classifyStatus(429), 'rate_limited');
  assert.strictEqual(A.classifyStatus(500), 'server_error');
  assert.strictEqual(A.classifyStatus(503), 'server_error');
  assert.strictEqual(A.classifyStatus(408), 'server_error');
  assert.strictEqual(A.classifyStatus(400), 'client_error');
  assert.strictEqual(A.classifyStatus(401), 'client_error');
  assert.strictEqual(A.classifyStatus(404), 'client_error');
});

test('parseRetryAfterMs handles delta-seconds, HTTP dates, and junk', () => {
  const now = 1_000_000;
  assert.strictEqual(A.parseRetryAfterMs('30', now), 30000);
  assert.strictEqual(A.parseRetryAfterMs('0', now), 0);
  assert.strictEqual(A.parseRetryAfterMs(null, now), null);
  assert.strictEqual(A.parseRetryAfterMs('', now), null);
  assert.strictEqual(A.parseRetryAfterMs('not-a-date', now), null);
  // HTTP date 10s in the future
  const future = new Date(now + 10000).toUTCString();
  const parsed = A.parseRetryAfterMs(future, now);
  // toUTCString truncates ms, so allow a 1s slop.
  assert.ok(Math.abs(parsed - 10000) <= 1000, `got ${parsed}`);
  // A past date clamps to 0.
  assert.strictEqual(A.parseRetryAfterMs(new Date(now - 5000).toUTCString(), now), 0);
});

test('computeBackoffMs grows exponentially and stays within [0, cap]', () => {
  const opts = { base: 500, cap: 20000, random: () => 1 }; // full jitter -> upper bound
  assert.strictEqual(A.computeBackoffMs(0, opts), 500);
  assert.strictEqual(A.computeBackoffMs(1, opts), 1000);
  assert.strictEqual(A.computeBackoffMs(2, opts), 2000);
  assert.strictEqual(A.computeBackoffMs(10, opts), 20000); // capped
  // jitter=0 -> lower bound is 0
  assert.strictEqual(A.computeBackoffMs(3, { ...opts, random: () => 0 }), 0);
  // half jitter -> half of the exponential window
  assert.strictEqual(A.computeBackoffMs(2, { ...opts, random: () => 0.5 }), 1000);
});

test('computeBackoffMs honors Retry-After (capped)', () => {
  assert.strictEqual(A.computeBackoffMs(0, { retryAfterMs: 3000, cap: 20000 }), 3000);
  assert.strictEqual(A.computeBackoffMs(5, { retryAfterMs: 999999, cap: 20000 }), 20000);
});

test('token bucket allows a burst then throttles, and refills over time', () => {
  const b = A.createTokenBucket({ capacity: 3, refillPerMinute: 60, initialTokens: 3, now: 0 });
  // Burst of 3 at t=0 all pass.
  assert.strictEqual(b.tryRemove(0), true);
  assert.strictEqual(b.tryRemove(0), true);
  assert.strictEqual(b.tryRemove(0), true);
  // 4th at t=0 is throttled (bucket empty).
  assert.strictEqual(b.tryRemove(0), false);
  // 60/min = 1/sec. After 1s, one token is back.
  assert.strictEqual(b.tryRemove(1000), true);
  assert.strictEqual(b.tryRemove(1000), false);
  // Never exceeds capacity even after a long idle.
  assert.ok(b.peek(10 * 60 * 1000) <= 3 + 1e-9);
});

test('nextAiStats only counts network attempts; non-attempts do not lower success rate', () => {
  let s = A.emptyAiStats();
  assert.strictEqual(A.successRate(s), null); // no attempts yet

  s = A.nextAiStats(s, 'success', 100);
  s = A.nextAiStats(s, 'success', 200);
  assert.strictEqual(s.attempts, 2);
  assert.strictEqual(s.success, 2);
  assert.strictEqual(A.successRate(s), 1);

  // "unconfigured" / "cached" / "throttled" are NOT failed attempts.
  s = A.nextAiStats(s, 'unconfigured', 300);
  s = A.nextAiStats(s, 'cached', 300);
  s = A.nextAiStats(s, 'throttled', 300);
  assert.strictEqual(s.attempts, 2, 'non-network outcomes must not count as attempts');
  assert.strictEqual(A.successRate(s), 1, 'success rate must stay 100% — this was the 0% bug');
  assert.strictEqual(s.cached, 1);
  assert.strictEqual(s.throttled, 1);

  // A real 429 and a real error DO count.
  s = A.nextAiStats(s, 'rate_limited', 400);
  s = A.nextAiStats(s, 'error', 500);
  assert.strictEqual(s.attempts, 4);
  assert.strictEqual(s.rateLimited, 1);
  assert.strictEqual(s.errors, 1);
  assert.strictEqual(A.successRate(s), 0.5);
  assert.strictEqual(s.lastStatus, 'error');
  assert.strictEqual(s.lastAt, 500);
});

test('ttl cache evicts by age and by size (LRU)', () => {
  const c = A.createTtlCache({ maxEntries: 2, ttlMs: 1000 });
  c.set('a', 'A', 0);
  c.set('b', 'B', 0);
  assert.strictEqual(c.get('a', 500), 'A');
  // Expired after ttl.
  assert.strictEqual(c.get('a', 2000), undefined);

  const c2 = A.createTtlCache({ maxEntries: 2, ttlMs: 100000 });
  c2.set('a', 'A', 0);
  c2.set('b', 'B', 0);
  c2.get('a', 1);            // touch 'a' so 'b' is now the LRU
  c2.set('c', 'C', 2);       // over capacity -> evict LRU ('b')
  assert.strictEqual(c2.get('b', 3), undefined);
  assert.strictEqual(c2.get('a', 3), 'A');
  assert.strictEqual(c2.get('c', 3), 'C');
});
