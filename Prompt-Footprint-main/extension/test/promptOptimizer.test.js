const test = require('node:test');
const assert = require('node:assert');
const O = require('../lib/promptOptimizer.js');

test('shorten removes politeness padding and filler', () => {
  const out = O.shorten('Could you please kindly write a function?');
  assert.ok(!/please/i.test(out));
  assert.ok(!/kindly/i.test(out));
  assert.ok(/write a function/i.test(out));
});

test('shorten substitutes verbose phrases', () => {
  const out = O.shorten('Do this in order to win due to the fact that it matters');
  assert.ok(/\bto win\b/.test(out));
  assert.ok(/\bbecause\b/.test(out));
  assert.ok(!/in order to/i.test(out));
});

test('shorten strips leading greetings', () => {
  const out = O.shorten('Hello, summarize this article');
  assert.ok(!/^hello/i.test(out));
  assert.ok(/summarize this article/i.test(out));
});

test('analyze reports positive savings for padded prompt', () => {
  const r = O.analyze(
    'Hi! Could you please, if it is not too much trouble, write a function in order to sort items? Thank you so much in advance!',
    'chatgpt'
  );
  assert.ok(r.changed);
  assert.ok(r.savedTokens > 0);
  assert.ok(r.savedPct > 0 && r.savedPct <= 100);
  assert.ok(r.savedEnergyWh > 0);
  assert.ok(r.newTokens < r.originalTokens);
});

test('analyze is a no-op for an already-tight prompt', () => {
  const r = O.analyze('Explain quicksort with an example.', 'chatgpt');
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.savedTokens, 0);
});

test('analyze never produces more tokens than the original', () => {
  const r = O.analyze('Refactor this code for readability and add tests.', 'chatgpt');
  assert.ok(r.newTokens <= r.originalTokens);
});

test('savings() computes the same shape for an arbitrary rewrite (AI path)', () => {
  const original = 'Please could you kindly help me write a function to sort an array';
  const rewritten = 'Write a function to sort an array';
  const r = O.savings(original, rewritten, 'claude');
  assert.ok(r.changed);
  assert.ok(r.savedTokens > 0);
  assert.strictEqual(r.shortened, rewritten);
  assert.ok(r.savedWaterMl > 0 && r.savedEnergyWh > 0);
});

test('savings() reports no change when the rewrite is not shorter', () => {
  const r = O.savings('Sort an array', 'Sort an array please now', 'chatgpt');
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.savedTokens, 0);
});

test('collapseRepeats removes duplicate words', () => {
  const out = O.shorten('Write the the function to to sort');
  assert.ok(!/\bthe the\b/i.test(out));
  assert.ok(!/\bto to\b/i.test(out));
});
