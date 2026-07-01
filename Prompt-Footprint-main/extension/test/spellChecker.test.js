const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../lib/spellChecker.js');
const Typo = require('../lib/vendor/typo.js');

// Small inline fixture dictionary → fast, deterministic, no 540KB load. The
// curated-typo path (recieve/teh/...) is covered without any dictionary at all.
const FIX_AFF = 'SET UTF-8\nTRY esianrtolcdugmphbyfvkw\n';
const FIX_DIC = ['9', 'hello', 'world', 'separate', 'receive', 'environment', 'the', 'cat', 'sat', 'function'].join('\n');
const typo = new Typo('en_US', FIX_AFF, FIX_DIC);

// The full shipped dictionary — used only where a test needs realistic
// dictionary-suggest behavior over arbitrary English text (the small fixture
// above only knows 9 words and would "correct" everything else into one of
// them, which isn't representative of real text).
const realAff = fs.readFileSync(path.join(__dirname, '../lib/dict/en_US.aff'), 'utf8');
const realDic = fs.readFileSync(path.join(__dirname, '../lib/dict/en_US.dic'), 'utf8');
const realTypo = S.createChecker(realAff, realDic);

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

// ── regression: real-Chrome failed-test input ───────────────────────────────
// The exact text that produced a no-op in a real Chrome run of the writing
// assistant. The local typo.js tier must fix the simple, safe issues (typos,
// "I", sentence-start capitalization) without attempting the advanced
// rewrite (joined words, smashed bullets) that is Gemini's job, and it must
// never "correct" tech/brand words into unrelated dictionary words.
const BAD_INPUT = "I receive the files but i don't know what to do next. can you make this promtp good and make sure it has bullet points- first fix the spell checker because it is not working- make the capsule moveable anywere on the screen- don't break chatgpt or claude tracking- add a privacy polciy section- make the github repo look profesional- make the readme betteralso make this **realy important part** more clear and don't mess up the bold text.";

test('regression: local fallback fixes all five target typos, with the dictionary', () => {
  const r = S.analyzeWriting(BAD_INPUT, { typo: realTypo });
  const text = r.safeFixedText;
  assert.match(text, /\bprompt\b/);
  assert.match(text, /\banywhere\b/);
  assert.match(text, /\bpolicy\b/);
  assert.match(text, /\bprofessional\b/);
  assert.match(text, /\breally\b/);
});

test('regression: local fallback fixes all five target typos WITHOUT the dictionary (curated-only)', () => {
  // typo: null simulates a real-Chrome dictionary-load failure — the curated
  // map alone must still catch these, since "fix the spell checker" was the
  // user's #1 complaint and it must not silently depend on the dictionary.
  const r = S.analyzeWriting(BAD_INPUT, { typo: null });
  const text = r.safeFixedText;
  assert.match(text, /\bprompt\b/);
  assert.match(text, /\banywhere\b/);
  assert.match(text, /\bpolicy\b/);
  assert.match(text, /\bprofessional\b/);
  assert.match(text, /\breally\b/);
});

test('regression: capitalization fixed ("i" -> "I", sentence-start "can" -> "Can")', () => {
  const r = S.analyzeWriting(BAD_INPUT, { typo: realTypo });
  assert.match(r.safeFixedText, /\bI don't know\b/);
  assert.match(r.safeFixedText, /\. Can you make\b/);
});

test('regression: markdown bold survives the local fix exactly', () => {
  const r = S.analyzeWriting(BAD_INPUT, { typo: realTypo });
  assert.ok(r.safeFixedText.includes('**really important part**'),
    `expected "**really important part**" intact, got: ${r.safeFixedText}`);
});

test('regression: tech/brand words are never corrupted into unrelated words', () => {
  const r = S.analyzeWriting(BAD_INPUT, { typo: realTypo });
  const text = r.safeFixedText;
  assert.doesNotMatch(text, /catgut/i, 'chatgpt must not become "catgut"');
  assert.doesNotMatch(text, /\brename\b/i, 'readme must not become "rename"');
  assert.doesNotMatch(text, /\brep\b/i, 'repo must not become "rep"');
  assert.match(text, /\bChatGPT\b/);
  assert.match(text, /\bClaude\b/);
  assert.match(text, /\bGitHub\b/);
  assert.match(text, /\bREADME\b/);
  assert.match(text, /\brepo\b/);
});

test('regression: local-only fallback does NOT attempt the advanced Gemini-only rewrite', () => {
  const r = S.analyzeWriting(BAD_INPUT, { typo: realTypo });
  // Smashed bullet list and the joined word are untouched locally — that is
  // Gemini's job per the typo.js-is-simple-spelling design rule.
  assert.ok(r.safeFixedText.includes('points- first fix'), 'local tier must not restructure bullets');
  assert.ok(r.safeFixedText.includes('betteralso'), 'local tier must not split joined words');
});
