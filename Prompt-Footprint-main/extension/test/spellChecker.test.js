const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/spellChecker.js');
const Typo = require('../lib/vendor/typo.js');

// Small inline fixture dictionary → fast, deterministic, no 540KB load. The
// curated-typo path (recieve/teh/...) is covered without any dictionary at all.
const FIX_AFF = 'SET UTF-8\nTRY esianrtolcdugmphbyfvkw\n';
const FIX_DIC = ['9', 'hello', 'world', 'separate', 'receive', 'environment', 'the', 'cat', 'sat', 'function'].join('\n');
const typo = new Typo('en_US', FIX_AFF, FIX_DIC);

test('createChecker returns a working Typo from aff/dic strings', () => {
  const t = S.createChecker(FIX_AFF, FIX_DIC);
  assert.ok(t && typeof t.check === 'function');
  assert.strictEqual(t.check('hello'), true);
  assert.strictEqual(t.check('helllo'), false);
});

test('createChecker degrades to null without data (no crash)', () => {
  assert.strictEqual(S.createChecker('', ''), null);
  assert.strictEqual(S.createChecker(null, null), null);
});

test('checkSpelling flags curated common typos with a safe fix (no dict needed)', () => {
  const out = S.checkSpelling('I recieve teh files', null);
  const words = out.map((s) => s.suggestion.toLowerCase());
  assert.ok(words.includes('receive'));
  assert.ok(words.includes('the'));
  assert.ok(out.every((s) => s.type === 'spelling'));
  assert.ok(out.find((s) => s.original === 'recieve').safe === true);
});

test('checkSpelling flags dictionary misspellings with a suggestion', () => {
  const out = S.checkSpelling('helllo world', typo);
  const hit = out.find((s) => s.original === 'helllo');
  assert.ok(hit, 'helllo should be flagged');
  assert.strictEqual(hit.suggestion.toLowerCase(), 'hello');
  assert.strictEqual(hit.safe, true);
});

test('checkSpelling is a no-op for clean, in-dictionary text', () => {
  assert.deepStrictEqual(S.checkSpelling('the cat', typo), []);
});

test('checkCapitalization catches sentence start and lone "i"', () => {
  const out = S.checkCapitalization('hello there. i am fine');
  const types = out.map((s) => s.reason);
  assert.ok(out.some((s) => s.original === 'h' && s.suggestion === 'H'));
  assert.ok(out.some((s) => s.original === 'i' && s.suggestion === 'I'));
  assert.ok(out.every((s) => s.safe === true));
});

test('checkPunctuation catches double spaces and space-before-punctuation', () => {
  const out = S.checkPunctuation('hello  world ,  ok');
  assert.ok(out.some((s) => s.reason === 'Remove extra spaces' && s.safe));
  assert.ok(out.some((s) => s.reason === 'Remove the space before punctuation' && s.safe));
});

test('checkPunctuation flags missing terminal punctuation as advisory only', () => {
  const out = S.checkPunctuation('please write a sorting function');
  const term = out.find((s) => s.reason === 'Add a period at the end');
  assert.ok(term);
  assert.strictEqual(term.safe, false);
});

test('checkGrammar catches repeated words and a/an', () => {
  const rep = S.checkGrammar('write the the function');
  assert.ok(rep.some((s) => s.reason === 'Repeated word' && s.suggestion === 'the' && s.safe));
  const an = S.checkGrammar('this is a apple');
  assert.ok(an.some((s) => s.suggestion === 'an apple' && s.safe === false));
});

test('analyzeWriting returns a safe-fixed text and a safe count', () => {
  const r = S.analyzeWriting('i recieve  teh files', { typo });
  assert.ok(r.changed);
  assert.ok(r.safeCount >= 1);
  // safeFixedText applies only safe fixes: typo, double-space, capitalize I + start.
  assert.ok(/I receive the files/.test(r.safeFixedText), r.safeFixedText);
  assert.ok(!/ {2,}/.test(r.safeFixedText));
});

test('analyzeWriting is a no-op (changed=false) for clean text', () => {
  const r = S.analyzeWriting('The cat sat.', { typo });
  assert.strictEqual(r.changed, false);
  assert.deepStrictEqual(r.suggestions, []);
});

// ── formatting preservation (bullets, numbering, **bold**, paragraphs) ───────
test('applySafeFixes preserves bullet markers while fixing the body', () => {
  const out = S.applySafeFixes('- i recieve teh files', typo);
  assert.ok(out.startsWith('- '), out);
  assert.ok(/I receive the files/.test(out), out);
});

test('applySafeFixes preserves numbered-list markers', () => {
  const out = S.applySafeFixes('1. teh first item', typo);
  assert.ok(/^1\. /.test(out), out);          // marker intact
  assert.ok(/the first item/i.test(out), out); // typo fixed (body may be sentence-cased)
});

test('applySafeFixes keeps **bold** markdown intact', () => {
  const out = S.applySafeFixes('make this **really** teh point', typo);
  assert.ok(out.includes('**really**'), out);
  assert.ok(/the point/.test(out), out);
});

test('applySafeFixes keeps paragraph breaks (blank lines) intact', () => {
  const src = 'first line\n\nsecond line';
  const out = S.applySafeFixes(src, typo);
  assert.strictEqual(out.split('\n').length, 3);
  assert.ok(out.includes('\n\n'));
});

test('applyOne replaces a single suggestion, preserving the rest', () => {
  const out = S.applyOne('I recieve files', { type: 'spelling', original: 'recieve', suggestion: 'receive' });
  assert.strictEqual(out, 'I receive files');
});
