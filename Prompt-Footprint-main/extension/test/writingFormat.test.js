const test = require('node:test');
const assert = require('node:assert');
const F = require('../lib/writingFormat.js');

test('diffBold bolds only the changed word', () => {
  const html = F.diffBold('write teh function', 'write the function');
  assert.ok(html.includes('<strong>the</strong>'), html);
  assert.ok(!html.includes('<strong>write</strong>'));
  assert.ok(!html.includes('<strong>function</strong>'));
});

test('diffBold bolds inserted words but leaves unchanged ones plain', () => {
  const html = F.diffBold('sort the array', 'sort the array quickly');
  assert.ok(html.includes('<strong>quickly</strong>'), html);
  assert.ok(html.includes('sort the array'));
});

test('diffBold never bolds whitespace and preserves spacing', () => {
  const html = F.diffBold('a b', 'a c');
  assert.ok(!/<strong>\s+<\/strong>/.test(html));
  assert.ok(html.includes('a '));
});

test('diffBold escapes HTML so prompt text cannot inject markup', () => {
  const html = F.diffBold('use <script>', 'use <b>safe</b>');
  assert.ok(!/<script>/.test(html));
  assert.ok(!/<b>/.test(html));
  assert.ok(html.includes('&lt;'));
});

test('renderSuggestion bolds the corrected text and escapes input', () => {
  const html = F.renderSuggestion({ original: 'teh', suggestion: 'the' });
  assert.ok(html.includes('teh'));
  assert.ok(html.includes('<strong>the</strong>'));
  const safe = F.renderSuggestion({ original: '<x>', suggestion: '<y>' });
  assert.ok(!/<x>|<y>/.test(safe));
  assert.ok(safe.includes('&lt;'));
});

test('escapeHtml handles the dangerous characters', () => {
  assert.strictEqual(F.escapeHtml('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});
