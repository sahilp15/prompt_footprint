// Timezone regression tests for the "Jul 1 shows on the wrong day" bug.
//
// Sessions are stored with UTC ISO timestamps, but day grouping / weekly buckets
// must follow the user's LOCAL calendar day. Before the fix, buckets were keyed
// by `new Date(iso).toISOString().slice(0,10)` (UTC), so a session created the
// evening of Jun 30 in a negative-UTC-offset zone (whose UTC timestamp is Jul 1)
// landed in the "Jul 1" bucket instead of the user's "Jun 30".
//
// Node applies process.env.TZ to subsequent Date operations, so we can pin a
// timezone per assertion. We restore the original TZ afterward.

const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/storage.js');

const ORIGINAL_TZ = process.env.TZ;
function withTZ(tz, fn) {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  }
}

test('localDayKey uses the local calendar day, not UTC', () => {
  // 02:00 UTC on Jul 1 is still Jun 30 (19:00) in US Pacific.
  const iso = '2026-07-01T02:00:00Z';
  withTZ('America/Los_Angeles', () => {
    assert.strictEqual(S.localDayKey(iso), '2026-06-30');
  });
  withTZ('UTC', () => {
    assert.strictEqual(S.localDayKey(iso), '2026-07-01');
  });
  // East of UTC: 22:00 UTC Jun 30 is already Jul 1 in Tokyo (07:00).
  withTZ('Asia/Tokyo', () => {
    assert.strictEqual(S.localDayKey('2026-06-30T22:00:00Z'), '2026-07-01');
  });
});

test('computeWeeklyStats buckets a session by the user local day (Pacific)', () => {
  withTZ('America/Los_Angeles', () => {
    // Session at 02:00 UTC Jul 1 == 19:00 local Jun 30. "now" is a bit later.
    const session = {
      startTime: '2026-07-01T02:00:00Z',
      totalTokens: 100,
      queryCount: 1,
    };
    const now = new Date('2026-07-01T04:00:00Z').getTime(); // 21:00 local Jun 30
    const wk = S.computeWeeklyStats([session], now);
    // It must land on Jun 30 (local), not Jul 1 (UTC).
    const jun30 = wk.daily.find((d) => d.date === '2026-06-30');
    const jul1 = wk.daily.find((d) => d.date === '2026-07-01');
    assert.ok(jun30, 'expected a 2026-06-30 bucket');
    assert.strictEqual(jun30.tokens, 100);
    assert.ok(!jul1, 'there should be no 2026-07-01 bucket for a Jun 30 local "now"');
  });
});

test('savings mergeSavings default day key follows local time', () => {
  withTZ('America/Los_Angeles', () => {
    const s = S.mergeSavings(S.emptySavings(), { savedTokens: 10 });
    const keys = Object.keys(s.daily);
    assert.strictEqual(keys.length, 1);
    // Whatever "now" is, the key must equal the local day of now.
    assert.strictEqual(keys[0], S.localDayKey());
  });
});
