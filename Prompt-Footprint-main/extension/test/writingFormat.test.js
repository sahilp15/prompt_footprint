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

// ── regression: real-Chrome failed-test input, AI tier diff display ────────
const BAD_INPUT = "I receive the files but i don't know what to do next. can you make this promtp good and make sure it has bullet points- first fix the spell checker because it is not working- make the capsule moveable anywere on the screen- don't break chatgpt or claude tracking- add a privacy polciy section- make the github repo look profesional- make the readme betteralso make this **realy important part** more clear and don't mess up the bold text.";

const EXPECTED_IMPROVED = `I received the files, but I don't know what to do next. Can you make this prompt good and make sure it has bullet points?

- First, fix the spell checker because it is not working.
- Make the capsule movable anywhere on the screen.
- Don't break ChatGPT or Claude tracking.
- Add a privacy policy section.
- Make the GitHub repo look professional.

Also, make this **really important part** more clear, and don't mess up the bold text.`;

test('regression: diffBold clearly bolds the changed words/phrases of the Gemini rewrite', () => {
  const html = F.diffBold(BAD_INPUT, EXPECTED_IMPROVED);
  // Newly-corrected words are bolded.
  assert.ok(html.includes('<strong>prompt</strong>') || html.includes('<strong>this prompt</strong>'), html.slice(0, 200));
  assert.ok(/\<strong\>[^<]*anywhere[^<]*\<\/strong\>/.test(html), 'anywhere should be bolded');
  assert.ok(/\<strong\>[^<]*policy[^<]*\<\/strong\>/.test(html), 'policy should be bolded');
  assert.ok(/\<strong\>[^<]*professional[^<]*\<\/strong\>/.test(html), 'professional should be bolded');
  // The restored bullet markers ("- First,", "- Make", ...) are new tokens, so bolded.
  assert.ok(html.includes('<strong>-</strong>') || /\<strong\>-[^<]*\<\/strong\>/.test(html),
    'restored bullet markers should show as a change');
});

test('regression: diffBold preserves **bold** markdown delimiters literally (not interpreted, not stripped)', () => {
  const html = F.diffBold(BAD_INPUT, EXPECTED_IMPROVED);
  // The literal "**" characters must survive in the rendered (escaped) HTML —
  // diffBold only wraps changed *tokens* in <strong>, it never interprets
  // markdown, so "**really" stays literal text (escaped HTML has no '<'/'>' of
  // its own to clash with) before/after our own <strong> wrapper.
  assert.ok(html.includes('**'), 'literal ** markdown markers must survive');
  assert.ok(!/<script|<img|<iframe/i.test(html), 'no markup injection');
});

test('regression: diffBold is injection-safe even on this exact failing input', () => {
  const html = F.diffBold(BAD_INPUT, EXPECTED_IMPROVED);
  // No unescaped raw '<' other than the <strong> tags we ourselves emit.
  const withoutOurTags = html.replace(/<\/?strong>/g, '');
  assert.ok(!withoutOurTags.includes('<'), withoutOurTags);
});
