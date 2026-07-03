const test = require('node:test');
const assert = require('node:assert');
const O = require('../lib/promptOptimizer.js');
const WF = require('../lib/writingFormat.js');
const SC = require('../lib/spellChecker.js');

test('detectRedundancy flags a content word repeated many times', () => {
  const text = 'The dashboard dashboard should show the dashboard and update the dashboard when the dashboard changes.';
  const hints = O.detectRedundancy(text);
  const rep = hints.find((h) => h.original === 'dashboard');
  assert.ok(rep, 'expected a repetition hint for "dashboard"');
  assert.strictEqual(rep.type, 'clarity');
  assert.strictEqual(rep.safe, false);
  assert.match(rep.reason, /times/);
});

test('detectRedundancy ignores normal prose and stopwords', () => {
  const text = 'Write a short function that reverses a string and returns the result.';
  const hints = O.detectRedundancy(text);
  assert.strictEqual(hints.length, 0);
  // "the"/"and" repeat but are stopwords — never flagged.
  const many = 'the cat and the dog and the bird and the fish and the mouse and the';
  assert.strictEqual(O.detectRedundancy(many).length, 0);
});

test('detectRedundancy flags an overly long sentence', () => {
  const long = 'I would like you to please carefully consider and then thoroughly analyze every single one of the many different possible approaches that we could conceivably take here while also keeping in mind all of the various constraints and requirements and edge cases and other considerations that might come up along the way somehow.';
  const hints = O.detectRedundancy(long);
  const lenHint = hints.find((h) => /Long sentence/.test(h.reason));
  assert.ok(lenHint, 'expected a long-sentence hint');
  assert.strictEqual(lenHint.type, 'clarity');
});

test('renderSuggestion shows clarity hints without a misleading "remove"', () => {
  const html = WF.renderSuggestion({ type: 'clarity', original: 'dashboard', suggestion: '', reason: 'Used 5 times' });
  assert.strictEqual(html, 'dashboard');
  // A real filler removal still renders "→ remove".
  const filler = WF.renderSuggestion({ type: 'filler', original: 'basically', suggestion: '', reason: 'x' });
  assert.match(filler, /remove/);
});

test('analyzeWriting surfaces clarity hints alongside spelling/filler', () => {
  const text = 'Please review the report report and the report and the report and the report now.';
  const res = SC.analyzeWriting(text, {});
  const hasClarity = res.suggestions.some((s) => s.type === 'clarity');
  assert.ok(hasClarity, 'analyzeWriting should include clarity hints');
  // Clarity hints are advisory only — they never inflate the "safe" auto-fix count.
  const clarity = res.suggestions.filter((s) => s.type === 'clarity');
  assert.ok(clarity.every((s) => s.safe === false));
});
