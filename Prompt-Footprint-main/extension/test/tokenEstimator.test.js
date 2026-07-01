const test = require('node:test');
const assert = require('node:assert');
const { estimateTokens, estimateQueryTokens } = require('../lib/tokenEstimator.js');

test('estimateTokens: empty / invalid input is 0', () => {
  assert.strictEqual(estimateTokens(''), 0);
  assert.strictEqual(estimateTokens('   '), 0);
  assert.strictEqual(estimateTokens(null), 0);
  assert.strictEqual(estimateTokens(undefined), 0);
  assert.strictEqual(estimateTokens(42), 0);
});

test('estimateTokens: ~4 chars per token, min 1', () => {
  assert.strictEqual(estimateTokens('a'), 1);
  assert.strictEqual(estimateTokens('abcd'), 1);
  assert.strictEqual(estimateTokens('abcde'), 2); // ceil(5/4)
  assert.strictEqual(estimateTokens('x'.repeat(40)), 10);
});

test('estimateQueryTokens: sums prompt + response', () => {
  const r = estimateQueryTokens('abcd', 'abcdefgh'); // 1 + 2
  assert.strictEqual(r.promptTokens, 1);
  assert.strictEqual(r.responseTokens, 2);
  assert.strictEqual(r.totalTokens, 3);
});
