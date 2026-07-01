const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../lib/spellChecker.js');

// Smoke test against the REAL shipped dictionary (en_US.aff/.dic). Proves the
// vendored Typo.js + compact dictionary actually load and detect misspellings
// that the curated typo map does NOT cover.
const aff = fs.readFileSync(path.join(__dirname, '../lib/dict/en_US.aff'), 'utf8');
const dic = fs.readFileSync(path.join(__dirname, '../lib/dict/en_US.dic'), 'utf8');
const typo = S.createChecker(aff, dic);

test('the shipped dictionary loads', () => {
  assert.ok(typo, 'createChecker should build a Typo from the shipped dict');
});

test('shipped dictionary accepts common words (incl. inflections from affixes)', () => {
  for (const w of ['hello', 'environment', 'running', 'cats', 'quickly']) {
    assert.strictEqual(typo.check(w), true, `expected "${w}" to be valid`);
  }
});

test('shipped dictionary flags a misspelling not in the curated map', () => {
  // "occassion" is not in promptOptimizer's COMMON_TYPOS, so this exercises the
  // real dictionary + suggestion path.
  const out = S.checkSpelling('this occassion', typo);
  const hit = out.find((s) => s.original === 'occassion');
  assert.ok(hit, 'occassion should be flagged by the dictionary');
  assert.ok(hit.suggestion && hit.suggestion.toLowerCase().includes('occasion'),
    `expected an "occasion" suggestion, got ${hit.suggestion}`);
});

test('analyzeWriting end-to-end with the real dictionary fixes a sentence', () => {
  const r = S.analyzeWriting('i beleive this is teh answer', { typo });
  assert.ok(r.changed);
  assert.ok(/I believe this is the answer/i.test(r.safeFixedText), r.safeFixedText);
});
