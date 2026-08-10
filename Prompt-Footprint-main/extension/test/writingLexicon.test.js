const test = require('node:test');
const assert = require('node:assert');
const O = require('../lib/writingLexicon.js');

// The curated word data behind the spell checker.
//
// This file used to test a SECOND prompt optimizer that lived here — a
// filler-stripping `shorten()` and a token-counting `savings()`. Both are gone:
// compression has one implementation now (the Token Cutter), and its contract is
// tested in `tokenCutterAggression.test.js`. What is left is the lexicon, and
// what matters about a lexicon is precision.

test('fixTypos corrects common misspellings and counts them', () => {
  const { text, count } = O.fixTypos('I recieved teh seperate document');
  assert.match(text, /received/);
  assert.match(text, /the separate document/);
  assert.strictEqual(count, 3);
});

test('fixTypos preserves the capitalization of what it replaced', () => {
  assert.strictEqual(O.fixTypos('Teh report').text, 'The report');
  assert.strictEqual(O.fixTypos('teh report').text, 'the report');
});

test('fixTypos is a no-op for clean text', () => {
  const { text, count } = O.fixTypos('This sentence is spelled correctly.');
  assert.strictEqual(text, 'This sentence is spelled correctly.');
  assert.strictEqual(count, 0);
});

test('detectFiller reports, and never rewrites', () => {
  const input = 'basically I just really want to actually make this very good';
  const hits = O.detectFiller(input);
  for (const word of ['basically', 'just', 'really', 'actually', 'very']) {
    assert.ok(hits.some((h) => h.original.toLowerCase() === word), `missing "${word}"`);
  }
  // Advisory only: every suggestion is something the user has to accept.
  assert.ok(hits.every((h) => h.safe === false));
  assert.ok(hits.every((h) => typeof h.reason === 'string' && h.reason.length > 0));
});

test('detectFiller offers a concise replacement for a wordy phrase', () => {
  const hits = O.detectFiller('We should do this in order to avoid delays.');
  const hit = hits.find((h) => /in order to/i.test(h.original));
  assert.ok(hit);
  assert.strictEqual(hit.suggestion, 'to');
});

test('detectRedundancy flags a repeated content word and a very long sentence', () => {
  const repeated = O.detectRedundancy(
    'The dashboard dashboard should show the dashboard and update the dashboard when the dashboard changes.',
  );
  assert.ok(repeated.some((h) => h.original === 'dashboard' && h.type === 'clarity'));

  const long = O.detectRedundancy(`${'word '.repeat(50)}.`);
  assert.ok(long.some((h) => /Long sentence/.test(h.reason)));
});

test('the module no longer exposes a second optimizer', () => {
  // Guard against it coming back. Two compression paths that can disagree about
  // what a prompt costs, or about what is safe to remove, is the bug this
  // removal fixed.
  for (const gone of ['shorten', 'analyze', 'savings', 'normalizeWhitespace']) {
    assert.strictEqual(O[gone], undefined, `${gone}() must not be reintroduced here`);
  }
});
