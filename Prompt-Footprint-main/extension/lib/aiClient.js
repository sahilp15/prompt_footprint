// PromptFootprint AI client helpers (rate limiting, backoff, metrics).
//
// The writing assistant sends draft text to a Gemini proxy (or a user-supplied
// Gemini key) when the user pauses typing. On the free tier that quota is easy
// to exhaust, which shows up as HTTP 429 (TooManyRequests) and — because the old
// code collapsed every non-2xx to '' — as a misleading "0% success rate".
//
// This module holds the pure, unit-testable pieces of a well-behaved client:
//   • a token-bucket rate limiter (a backstop against runaway calls),
//   • a global cooldown after a 429 (the correct response to rate limiting is to
//     STOP sending for a while, honoring Retry-After — not to hammer harder),
//   • exponential backoff WITH JITTER for transient 5xx/network errors,
//   • honest success/failure/rate-limited accounting (a call is only "attempted"
//     when a network request was actually made; "not configured" is not a
//     failure).
//
// Loaded both as a service-worker global (self.PFAiClient) and under Node tests.

(function (root) {
  'use strict';

  // ── Response classification ───────────────────────────────────────────────
  // 'ok'           2xx — usable response
  // 'rate_limited' 429 — quota/rate exceeded; back off (cooldown)
  // 'server_error' 5xx / 408 — transient; safe to retry with backoff
  // 'client_error' other 4xx — our fault; do NOT retry
  function classifyStatus(status) {
    if (status >= 200 && status < 300) return 'ok';
    if (status === 429) return 'rate_limited';
    if (status === 408 || (status >= 500 && status < 600)) return 'server_error';
    return 'client_error';
  }

  // Parse a Retry-After header (delta-seconds or an HTTP date) into a delay in ms
  // relative to `nowMs`. Returns null when absent/unparseable. Clamped to >= 0.
  function parseRetryAfterMs(headerValue, nowMs) {
    if (headerValue == null || headerValue === '') return null;
    const secs = Number(headerValue);
    if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
    const when = Date.parse(headerValue);
    if (Number.isFinite(when)) return Math.max(0, when - nowMs);
    return null;
  }

  // Exponential backoff with full jitter.
  //   base * 2^attempt, capped, then a random point in [0, capped].
  // `random` is injectable for deterministic tests; defaults to Math.random.
  // If retryAfterMs is provided it wins (honor the server's instruction) but is
  // still capped so a hostile header can't stall us for minutes.
  function computeBackoffMs(attempt, opts) {
    const o = opts || {};
    const base = o.base != null ? o.base : 500;
    const cap = o.cap != null ? o.cap : 20000;
    const rnd = typeof o.random === 'function' ? o.random : Math.random;
    if (o.retryAfterMs != null) return Math.min(cap, Math.max(0, o.retryAfterMs));
    const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempt)));
    return Math.round(rnd() * exp);
  }

  // ── Token bucket ──────────────────────────────────────────────────────────
  // capacity: max burst; refillPerMinute: sustained rate. tryRemove(now) returns
  // true if a token was available (request allowed), false otherwise.
  function createTokenBucket(opts) {
    const o = opts || {};
    const capacity = o.capacity != null ? o.capacity : 5;
    const refillPerMinute = o.refillPerMinute != null ? o.refillPerMinute : 10;
    let tokens = o.initialTokens != null ? o.initialTokens : capacity;
    let last = o.now != null ? o.now : 0;
    return {
      tryRemove(now) {
        const elapsed = Math.max(0, now - last);
        tokens = Math.min(capacity, tokens + (elapsed / 60000) * refillPerMinute);
        last = now;
        if (tokens >= 1) {
          tokens -= 1;
          return true;
        }
        return false;
      },
      peek(now) {
        const elapsed = Math.max(0, now - last);
        return Math.min(capacity, tokens + (elapsed / 60000) * refillPerMinute);
      },
    };
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  // Pure reducer over outcomes so the popup/dashboard can show a truthful state.
  // Outcomes that actually hit the network: 'success' | 'rate_limited' | 'error'.
  // 'unconfigured' | 'cached' | 'throttled' | 'cooldown' are NOT network attempts
  // and must not drag the success rate down (this is the "0% success" bug).
  function emptyAiStats() {
    return {
      attempts: 0,      // network requests actually made
      success: 0,
      rateLimited: 0,   // 429s
      errors: 0,        // 5xx / 4xx / network / timeout
      cached: 0,        // served from cache, no network
      throttled: 0,     // blocked by our own rate limiter, no network
      lastStatus: null, // 'success' | 'rate_limited' | 'error' | ...
      lastAt: null,     // epoch ms of the last network attempt
    };
  }

  function nextAiStats(prev, outcome, atMs) {
    const s = { ...emptyAiStats(), ...(prev || {}) };
    switch (outcome) {
      case 'success':
        s.attempts += 1; s.success += 1; s.lastStatus = 'success'; s.lastAt = atMs; break;
      case 'rate_limited':
        s.attempts += 1; s.rateLimited += 1; s.lastStatus = 'rate_limited'; s.lastAt = atMs; break;
      case 'error':
        s.attempts += 1; s.errors += 1; s.lastStatus = 'error'; s.lastAt = atMs; break;
      case 'cached':
        s.cached += 1; break;
      case 'throttled':
      case 'cooldown':
        s.throttled += 1; s.lastStatus = 'rate_limited'; break;
      default:
        break; // 'unconfigured' etc: no-op
    }
    return s;
  }

  // Success rate over ACTUAL network attempts (0..1), or null if none yet.
  function successRate(stats) {
    if (!stats || !stats.attempts) return null;
    return stats.success / stats.attempts;
  }

  // ── Bounded TTL cache ─────────────────────────────────────────────────────
  // Small LRU-ish cache so identical drafts (across tabs / repeated pauses) don't
  // re-hit the network. Only successful, non-empty results are cached.
  function createTtlCache(opts) {
    const o = opts || {};
    const maxEntries = o.maxEntries != null ? o.maxEntries : 100;
    const ttlMs = o.ttlMs != null ? o.ttlMs : 10 * 60 * 1000;
    const map = new Map();
    return {
      get(key, now) {
        const e = map.get(key);
        if (!e) return undefined;
        if (now - e.at > ttlMs) { map.delete(key); return undefined; }
        // refresh recency
        map.delete(key); map.set(key, e);
        return e.value;
      },
      set(key, value, now) {
        if (map.has(key)) map.delete(key);
        map.set(key, { value, at: now });
        while (map.size > maxEntries) {
          const oldest = map.keys().next().value;
          map.delete(oldest);
        }
      },
      get size() { return map.size; },
    };
  }

  const PFAiClient = {
    classifyStatus,
    parseRetryAfterMs,
    computeBackoffMs,
    createTokenBucket,
    createTtlCache,
    emptyAiStats,
    nextAiStats,
    successRate,
  };

  if (root) root.PFAiClient = PFAiClient;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFAiClient;
})(typeof self !== 'undefined' ? self : this);
