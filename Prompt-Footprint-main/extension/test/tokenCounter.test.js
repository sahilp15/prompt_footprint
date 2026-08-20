// Provider- and model-aware token counting.
// ---------------------------------------------------------------------------
// The bug these tests exist for: one `Math.ceil(text.length / 4)` was used for
// every provider. It is roughly right for English on an OpenAI model and wrong
// by ~60% on Claude's current tokenizer, which Anthropic documents at ~2.5
// characters per token against OpenAI's ~4.
//
// Two kinds of assertion here, and the distinction matters:
//
//   EXACT      the pre-tokenization split, which comes from tiktoken's own
//              source and is not an approximation. Asserted precisely.
//   CALIBRATED the per-piece cost, which stands in for a BPE merge table we do
//              not ship. Asserted against the providers' own published ratios,
//              with a tolerance that is stated rather than implied.

const test = require('node:test');
const assert = require('node:assert');
const TC = require('../lib/tokens/counter.js');
const K = require('../lib/tokens/constants.js');

/** Representative English prose, the corpus both providers' ratios describe. */
const PROSE = [
  'The quick brown fox jumps over the lazy dog. She sold sea shells by the sea shore on a bright and sunny morning in early June.',
  'Please review the attached quarterly report and summarize the three most significant risks for the executive team before Friday.',
  'The rapid expansion of artificial intelligence has transformed how organizations approach data analysis, decision making, and customer engagement.',
];

function ratio(profileId) {
  const chars = PROSE.reduce((n, s) => n + s.length, 0);
  const tokens = PROSE.reduce((n, s) => n + TC.countWithProfile(s, profileId), 0);
  return chars / tokens;
}

// ── Pre-tokenization: the exact half ───────────────────────────────────────

test('o200k splits exactly where tiktoken’s own pattern says it does', () => {
  assert.deepStrictEqual(
    TC.pretokenize('Hello, world!', 'o200k_base'),
    ['Hello', ',', ' world', '!'],
  );
  assert.deepStrictEqual(
    TC.pretokenize('The quick brown fox.', 'o200k_base'),
    ['The', ' quick', ' brown', ' fox', '.'],
  );
});

test('digit runs are capped at three, as the pattern requires', () => {
  // `\p{N}{1,3}` — this is why " 1234567" is not one token however common the
  // number is, and why a spreadsheet of figures costs more than its characters
  // suggest.
  assert.deepStrictEqual(TC.pretokenize('1234567', 'o200k_base'), ['123', '456', '7']);
  assert.strictEqual(TC.countWithProfile('1234567', 'o200k_base'), 3);
});

test('a leading space belongs to the word that follows it', () => {
  const pieces = TC.pretokenize('the the the', 'o200k_base');
  assert.deepStrictEqual(pieces, ['the', ' the', ' the']);
  assert.strictEqual(TC.countWithProfile('the the the', 'o200k_base'), 3,
    'not six — the space is inside the token, not a token of its own');
});

test('newlines and indentation collapse the way a BPE collapses them', () => {
  assert.strictEqual(TC.countWithProfile('\n\n', 'o200k_base'), 1);
  assert.strictEqual(TC.countWithProfile('    ', 'o200k_base'), 1, 'a four-space indent is one token');
});

// ── Calibration: the estimated half ────────────────────────────────────────

test('OpenAI profiles land on the documented ~4 characters per token', () => {
  const r = ratio('o200k_base');
  assert.ok(r > 3.6 && r < 4.4, `o200k_base measured ${r.toFixed(2)} chars/token`);
});

test('Claude’s current tokenizer lands on its documented ~2.5 characters per token', () => {
  // Anthropic's Models overview states 1M tokens ~= 2.5M unicode characters for
  // Claude Fable 5 / Opus 5 / Sonnet 5.
  const r = ratio('claude-4.7');
  assert.ok(r > 2.2 && r < 2.8, `claude-4.7 measured ${r.toFixed(2)} chars/token`);
});

test('Claude’s older tokenizer lands on its documented ~3.4 characters per token', () => {
  // The same table gives 1M tokens ~= 3.4M characters for Opus 4.6 / Sonnet 4.6.
  const r = ratio('claude-legacy');
  assert.ok(r > 3.1 && r < 3.7, `claude-legacy measured ${r.toFixed(2)} chars/token`);
});

test('the newer Claude tokenizer produces roughly 30% more tokens than the older one', () => {
  // Documented verbatim: "compared to models before Claude Opus 4.7, the same
  // text produces roughly 30% more tokens".
  const newer = PROSE.reduce((n, s) => n + TC.countWithProfile(s, 'claude-4.7'), 0);
  const older = PROSE.reduce((n, s) => n + TC.countWithProfile(s, 'claude-legacy'), 0);
  const increase = newer / older;
  assert.ok(increase > 1.2 && increase < 1.55, `measured +${Math.round((increase - 1) * 100)}%`);
});

test('the two providers do NOT agree on the same text', () => {
  // The whole point. If this ever passes trivially, one generic estimator has
  // crept back in.
  const text = PROSE.join(' ');
  const openai = TC.countWithProfile(text, 'o200k_base');
  const claude = TC.countWithProfile(text, 'claude-4.7');
  assert.ok(claude > openai * 1.3,
    `Claude ${claude} vs OpenAI ${openai} — these must not be the same number`);
});

test('cl100k is worse than o200k for non-Latin scripts, as it is in reality', () => {
  const chinese = '请总结这份季度报告的主要风险点和建议';
  const modern = TC.countWithProfile(chinese, 'o200k_base');
  const legacy = TC.countWithProfile(chinese, 'cl100k_base');
  assert.ok(legacy > modern, `cl100k ${legacy} should exceed o200k ${modern}`);
  assert.ok(modern / chinese.length < 1.1, 'o200k should be under ~1 token per CJK character');
});

// ── Content shapes ─────────────────────────────────────────────────────────

test('code is not counted with English-word assumptions', () => {
  const code = 'function calculateTotal(items) {\n  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n}';
  const tokens = TC.countWithProfile(code, 'o200k_base');
  const prose = TC.countWithProfile('a'.repeat(code.length), 'o200k_base');
  assert.ok(tokens > 0);
  assert.ok(code.length / tokens < 4,
    `code measured ${(code.length / tokens).toFixed(2)} chars/token — denser than prose, as it should be`);
  assert.notStrictEqual(tokens, prose);
});

test('JSON punctuation is counted, not skipped', () => {
  const json = '{"name":"Alice","age":30,"tags":["a","b"]}';
  const tokens = TC.countWithProfile(json, 'o200k_base');
  assert.ok(tokens >= 12, `JSON structure must contribute (got ${tokens})`);
  assert.ok(json.length / tokens < 3.5, 'JSON is denser than prose per character');
});

test('markdown syntax contributes tokens because it is sent', () => {
  const plain = 'Heading\nRead the report\nNote edge cases';
  const md = '# Heading\n\n- [ ] Read the **report**\n- [ ] Note `edge cases`';
  assert.ok(TC.countWithProfile(md, 'o200k_base') > TC.countWithProfile(plain, 'o200k_base'),
    'the syntax is part of the message');
});

test('emoji and unicode are costed by UTF-8 bytes, not by character count', () => {
  const emoji = '👋🌍🚀';
  const ascii = 'abc';
  assert.ok(TC.countWithProfile(emoji, 'o200k_base') >= TC.countWithProfile(ascii, 'o200k_base'),
    'a 4-byte emoji is not a 1-byte letter');
  assert.ok(TC.countWithProfile('Résumé naïve façade', 'o200k_base') > 0);
});

test('empty and whitespace-only input cost nothing', () => {
  assert.strictEqual(TC.countWithProfile('', 'o200k_base'), 0);
  assert.strictEqual(TC.count('', { provider: 'openai' }), 0);
});

// ── Strategy resolution ────────────────────────────────────────────────────

test('OpenAI model ids resolve through tiktoken’s own prefix table', () => {
  assert.strictEqual(TC.openaiEncodingFor('gpt-5.6-sol'), 'o200k_base');
  assert.strictEqual(TC.openaiEncodingFor('gpt-5.4-thinking'), 'o200k_base');
  assert.strictEqual(TC.openaiEncodingFor('gpt-4-turbo'), 'cl100k_base');
  assert.strictEqual(TC.openaiEncodingFor('gpt-3.5-turbo-16k'), 'cl100k_base');
  assert.strictEqual(TC.openaiEncodingFor('o3-mini'), 'o200k_base');
  assert.strictEqual(TC.openaiEncodingFor('something-else'), null);
});

test('a longer prefix wins, as tiktoken resolves it', () => {
  assert.strictEqual(TC.openaiEncodingFor('gpt-4o-mini'), 'o200k_base',
    '"gpt-4o-" must beat "gpt-4-"');
});

test('Claude models resolve to the right tokenizer generation', () => {
  assert.strictEqual(K.anthropicProfileFor('claude-opus-5'), 'claude-4.7');
  assert.strictEqual(K.anthropicProfileFor('claude-fable-5'), 'claude-4.7');
  assert.strictEqual(K.anthropicProfileFor('claude-opus-4-7'), 'claude-4.7');
  assert.strictEqual(K.anthropicProfileFor('claude-opus-4-6'), 'claude-legacy');
  assert.strictEqual(K.anthropicProfileFor('claude-haiku-4-5'), 'claude-legacy');
});

test('a known model is counted with a local tokenizer at high confidence', () => {
  const r = TC.countText('Summarize the report.', { provider: 'anthropic', canonicalModel: 'claude-opus-5' });
  assert.strictEqual(r.method, 'local-tokenizer');
  assert.strictEqual(r.confidence, 'high');
  assert.strictEqual(r.tokenizer, 'claude-4.7');
  assert.notStrictEqual(r.confidence, 'exact', 'nothing computed locally is exact');
});

test('ChatGPT Auto is counted honestly as an estimate, never as a named model', () => {
  const r = TC.countText('Summarize the report.', {
    provider: 'openai', canonicalModel: null, routing: 'auto', selectedLabel: 'Auto',
  });
  assert.strictEqual(r.model, null, 'Auto must not resolve to a model id');
  assert.strictEqual(r.method, 'model-estimate');
  assert.strictEqual(r.confidence, 'estimated');
  assert.match(r.reason, /Auto does not expose the routed model/);
  assert.strictEqual(r.tokenizer, 'o200k_base', 'still the right family default');
});

test('an unknown provider falls back to generic and says so', () => {
  const r = TC.countText('Summarize the report.', { provider: 'unknown' });
  assert.strictEqual(r.method, 'generic-estimate');
  assert.strictEqual(r.confidence, 'estimated');
  assert.strictEqual(r.tokenizer, 'generic');
});

test('an unmapped OpenAI model degrades rather than guessing', () => {
  const r = TC.countText('Summarize the report.', {
    provider: 'openai', canonicalModel: null, selectedLabel: 'GPT-7.2 Nimbus',
  });
  assert.strictEqual(r.method, 'model-estimate');
  assert.strictEqual(r.confidence, 'estimated');
  assert.match(r.reason, /not in the registry/);
});

test('every result carries a band, and a wider one when confidence is lower', () => {
  const high = TC.countText(PROSE.join(' '), { provider: 'openai', canonicalModel: 'gpt-5.6-sol' });
  const low = TC.countText(PROSE.join(' '), { provider: 'unknown' });
  assert.ok(high.low < high.count && high.count < high.high);
  assert.ok((low.high - low.low) / low.count > (high.high - high.low) / high.count,
    'an estimate must be presented as a wider band than a local tokenizer count');
});

// ── Performance ────────────────────────────────────────────────────────────

test('a 20,000-word paste counts fast enough not to be felt while typing', () => {
  const huge = Array.from({ length: 20000 }, (_, i) => `word${i % 400}`).join(' ');
  const started = process.hrtime.bigint();
  const tokens = TC.countWithProfile(huge, 'o200k_base');
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(tokens > 20000, `20k words should exceed 20k tokens, got ${tokens}`);
  assert.ok(ms < 400, `took ${ms.toFixed(0)}ms — this runs on a keystroke`);
});
