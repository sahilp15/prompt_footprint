const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/composer.js');
const dom = require('./helpers/dom.js');

// Composer detection is the extension's most fragile contact point with two
// third-party React apps, so it is tested at both levels: the scoring rules on
// their own (pure, always runs) and the real DOM walk against pages shaped like
// ChatGPT and Claude actually ship (needs jsdom).

const base = {
  tag: 'DIV',
  isContentEditable: true,
  role: 'textbox',
  visible: true,
  width: 600,
  height: 60,
  top: 500,
  viewportHeight: 900,
  label: 'Ask anything',
  matchesAdapter: false,
  hasNearbySend: true,
  inForm: true,
  editorHint: true,
  insideOwnUi: false,
};

// ── Scoring ────────────────────────────────────────────────────────────────

test('a ChatGPT-shaped composer clears the confidence floor', () => {
  assert.ok(C.scoreCandidate(base) >= C.MIN_SCORE);
});

test('detection survives losing any single signal', () => {
  // The whole point of scoring: no one signal may be load-bearing, because each
  // one is something a redesign can take away.
  for (const missing of ['editorHint', 'matchesAdapter', 'hasNearbySend', 'inForm', 'label']) {
    const d = { ...base, [missing]: missing === 'label' ? '' : false };
    assert.ok(
      C.scoreCandidate(d) >= C.MIN_SCORE,
      `losing "${missing}" should not stop detection (score ${C.scoreCandidate(d)})`,
    );
  }
});

test('an element with no supporting evidence is not a composer', () => {
  // A big editable box near the bottom of the page is suggestive but not proof.
  // Without a send control, a known editor, or a prompt-like label it is left
  // alone — attaching to the wrong element is worse than attaching to none.
  const bare = {
    ...base, editorHint: false, matchesAdapter: false, hasNearbySend: false,
    inForm: false, label: '', role: '',
  };
  assert.ok(C.scoreCandidate(bare) < C.MIN_SCORE);
});

test('search, rename, and password boxes are vetoed outright', () => {
  for (const label of ['Search chats', 'Rename conversation', 'Email address']) {
    assert.strictEqual(C.scoreCandidate({ ...base, label }), 0, label);
  }
});

test('hidden, tiny, disabled, and read-only candidates score zero', () => {
  assert.strictEqual(C.scoreCandidate({ ...base, visible: false }), 0);
  assert.strictEqual(C.scoreCandidate({ ...base, width: 40 }), 0);
  assert.strictEqual(C.scoreCandidate({ ...base, height: 4 }), 0);
  assert.strictEqual(C.scoreCandidate({ ...base, disabled: true }), 0);
  assert.strictEqual(C.scoreCandidate({ ...base, readOnly: true }), 0);
});

test('the assistant never targets its own UI', () => {
  assert.strictEqual(C.scoreCandidate({ ...base, insideOwnUi: true }), 0);
});

test('a non-editable element is never a composer', () => {
  const div = { ...base, tag: 'DIV', isContentEditable: false, role: '' };
  assert.strictEqual(C.scoreCandidate(div), 0);
});

test('pickBest takes the strongest candidate and null when none qualify', () => {
  const weak = { ...base, editorHint: false, hasNearbySend: false, inForm: false, label: '', role: '' };
  const best = C.pickBest([weak, base]);
  assert.strictEqual(best.descriptor, base);
  assert.strictEqual(C.pickBest([weak]), null);
  assert.strictEqual(C.pickBest([]), null);
});

test('pickBest breaks ties on area, so the visible editor beats its hidden twin', () => {
  const small = { ...base, height: 32, width: 300 };
  const large = { ...base, height: 60, width: 700 };
  assert.strictEqual(C.pickBest([small, large]).descriptor, large);
  assert.strictEqual(C.pickBest([large, small]).descriptor, large);
});

// ── DOM detection ──────────────────────────────────────────────────────────

test('finds the Lexical composer on a ChatGPT-shaped page', { skip: !dom.available }, () => {
  const page = dom.createPage(dom.CHATGPT_HTML);
  try {
    const doc = page.document;
    dom.size(doc.getElementById('prompt-textarea'), { width: 620, height: 52, top: 640 });
    dom.size(doc.getElementById('decoy-rename'), { width: 240, height: 30, top: 40 });
    const found = C.findComposer(doc, { adapterSelector: '#prompt-textarea' });
    assert.strictEqual(found && found.id, 'prompt-textarea');
  } finally {
    page.restore();
  }
});

test('finds the ProseMirror composer on a Claude-shaped page', { skip: !dom.available }, () => {
  const page = dom.createPage(dom.CLAUDE_HTML, { url: 'https://claude.ai/new' });
  try {
    const el = page.document.querySelector('.ProseMirror');
    dom.size(el, { width: 700, height: 48, top: 600 });
    const found = C.findComposer(page.document, {
      adapterSelector: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
    });
    assert.strictEqual(found, el);
  } finally {
    page.restore();
  }
});

test('finds a legacy textarea composer', { skip: !dom.available }, () => {
  const page = dom.createPage(dom.TEXTAREA_HTML);
  try {
    const el = page.document.getElementById('prompt-textarea');
    dom.size(el, { width: 600, height: 44, top: 700 });
    assert.strictEqual(C.findComposer(page.document, {}), el);
  } finally {
    page.restore();
  }
});

test('reports no composer rather than guessing on an unrelated page', { skip: !dom.available }, () => {
  const page = dom.createPage('<!doctype html><html><body><input aria-label="Search"></body></html>');
  try {
    assert.strictEqual(C.findComposer(page.document, {}), null);
  } finally {
    page.restore();
  }
});

test('detection still works when the adapter selector has gone stale', { skip: !dom.available }, () => {
  // Simulates a ChatGPT redesign: the id and the lexical attribute are gone, so
  // both the adapter selector and the editor hint miss. The send button and the
  // placeholder still identify it.
  const page = dom.createPage(`<!doctype html><html><body><form>
      <div contenteditable="true" class="brand-new-editor" data-placeholder="Message ChatGPT"></div>
      <button data-testid="send-button" aria-label="Send"></button>
    </form></body></html>`);
  try {
    const el = page.document.querySelector('.brand-new-editor');
    dom.size(el, { width: 600, height: 50, top: 700 });
    assert.strictEqual(C.findComposer(page.document, { adapterSelector: '#prompt-textarea' }), el);
  } finally {
    page.restore();
  }
});

// ── Reading ────────────────────────────────────────────────────────────────

test('readText keeps the line breaks a Lexical editor renders as paragraphs',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.CHATGPT_HTML);
    try {
      const el = page.document.getElementById('prompt-textarea');
      el.innerHTML = '<p>First line</p><p>Second line</p><p>Third<br>wrapped</p>';
      assert.strictEqual(C.readText(el), 'First line\nSecond line\nThird\nwrapped');
    } finally {
      page.restore();
    }
  });

test('readText returns a textarea value verbatim', { skip: !dom.available }, () => {
  const page = dom.createPage(dom.TEXTAREA_HTML);
  try {
    const el = page.document.getElementById('prompt-textarea');
    el.value = 'line one\nline two';
    assert.strictEqual(C.readText(el), 'line one\nline two');
  } finally {
    page.restore();
  }
});

// ── Writing ────────────────────────────────────────────────────────────────

test('writeText drives a textarea through the native setter and fires input',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.TEXTAREA_HTML);
    try {
      const el = page.document.getElementById('prompt-textarea');
      const events = [];
      el.addEventListener('input', () => events.push('input'));
      el.addEventListener('change', () => events.push('change'));

      assert.strictEqual(C.writeText(el, 'optimized prompt'), true);
      assert.strictEqual(el.value, 'optimized prompt');
      // Both events matter: React listens for input, some editors for change.
      assert.deepStrictEqual(events, ['input', 'change']);
    } finally {
      page.restore();
    }
  });

test('writeText uses execCommand on a contenteditable so the editor sees a real edit',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.CHATGPT_HTML);
    try {
      const el = page.document.getElementById('prompt-textarea');
      el.innerHTML = '<p>old text</p>';
      el.focus();
      assert.strictEqual(C.writeText(el, 'new text'), true);
      // The primary path ran — no innerHTML surgery, which is what would leave
      // Lexical's model out of step with what the user can see.
      assert.deepStrictEqual(page.commands, [{ command: 'insertText', value: 'new text' }]);
      assert.strictEqual(C.readText(el), 'new text');
    } finally {
      page.restore();
    }
  });

test('writeText round-trips text containing code, URLs, and newlines',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.TEXTAREA_HTML);
    try {
      const el = page.document.getElementById('prompt-textarea');
      const text = 'See https://example.com/a?b=1\n\n```js\nconst x = 1;\n```\nKeep "this" exact.';
      assert.strictEqual(C.writeText(el, text), true);
      assert.strictEqual(C.readText(el), text);
    } finally {
      page.restore();
    }
  });
