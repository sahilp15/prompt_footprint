const test = require('node:test');
const assert = require('node:assert');
const PS = require('../lib/promptSize.js');
const S = require('../lib/storage.js');

test('computeAveragePromptTokens averages per-query promptTokens, ignoring zeros', () => {
  const sessions = [
    { queries: [{ promptTokens: 100 }, { promptTokens: 200 }] },
    { queries: [{ promptTokens: 300 }, { promptTokens: 0 }, { responseTokens: 50 }] },
  ];
  const r = S.computeAveragePromptTokens(sessions);
  assert.strictEqual(r.sampleCount, 3);
  assert.strictEqual(r.avgPromptTokens, 200); // (100+200+300)/3
});

test('computeAveragePromptTokens handles empty/no-query input', () => {
  assert.deepStrictEqual(S.computeAveragePromptTokens([]), { avgPromptTokens: 0, sampleCount: 0 });
  assert.deepStrictEqual(S.computeAveragePromptTokens([{ queries: [] }]), { avgPromptTokens: 0, sampleCount: 0 });
});

test('a prompt much larger than the personal average gets the gentle warning', () => {
  const r = PS.classifyPromptSize(500, { avgPromptTokens: 200, sampleCount: 20 });
  assert.strictEqual(r.level, 'large');
  assert.match(r.message, /much larger than your average/);
  assert.strictEqual(r.avgPromptTokens, 200);
  assert.strictEqual(r.hasHistory, true);
});

test('an about-average or smaller prompt gets no nag', () => {
  const typical = PS.classifyPromptSize(220, { avgPromptTokens: 200, sampleCount: 20 });
  assert.strictEqual(typical.level, 'typical');
  assert.strictEqual(typical.message, '');
  const small = PS.classifyPromptSize(80, { avgPromptTokens: 200, sampleCount: 20 });
  assert.strictEqual(small.level, 'short');
  assert.strictEqual(small.message, '');
});

test('too-short prompts are neutral regardless of history', () => {
  const r = PS.classifyPromptSize(5, { avgPromptTokens: 200, sampleCount: 20 });
  assert.strictEqual(r.level, 'neutral');
  assert.strictEqual(r.message, '');
});

test('without enough history it falls back to neutral global bands', () => {
  // Only 2 past prompts — not enough to compare personally.
  const shortP = PS.classifyPromptSize(40, { avgPromptTokens: 40, sampleCount: 2 });
  assert.strictEqual(shortP.hasHistory, false);
  assert.strictEqual(shortP.level, 'short');
  assert.strictEqual(shortP.message, '');

  const longP = PS.classifyPromptSize(600, { avgPromptTokens: 40, sampleCount: 2 });
  assert.strictEqual(longP.hasHistory, false);
  assert.strictEqual(longP.level, 'long');
  assert.match(longP.message, /long prompt/);
});

test('averageLabel reflects whether there is enough history', () => {
  assert.strictEqual(PS.averageLabel(420, 20), 'Your average prompt: 420 tokens');
  assert.strictEqual(PS.averageLabel(420, 2), 'Your average prompt: not enough history yet');
  assert.strictEqual(PS.averageLabel(0, 0), 'Your average prompt: not enough history yet');
});
