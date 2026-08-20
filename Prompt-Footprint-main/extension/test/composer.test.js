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

test('writeText falls back to execCommand for a plain contenteditable',
  { skip: !dom.available }, () => {
    // Nothing here owns a model, so nobody cancels our beforeinput and the
    // native command is the correct tool. It is the LAST resort, not the first —
    // and it is offered ONLY on a box like this one, never on Lexical or
    // ProseMirror, where it would edit the DOM behind the editor's back.
    const page = dom.createPage(dom.PLAIN_HTML);
    try {
      const el = page.document.getElementById('prompt-box');
      el.innerHTML = '<p>old text</p>';
      el.focus();
      assert.strictEqual(C.writeText(el, 'new text'), true);
      assert.deepStrictEqual(page.commands, [{ command: 'insertText', value: 'new text' }]);
      assert.strictEqual(C.readText(el), 'new text');
    } finally {
      page.restore();
    }
  });

// ── Editors that own their document model ──────────────────────────────────
// The regression tests for the reported bug: the composer showed the new prompt
// while the editor's model — the thing that actually gets sent — still held the
// old one.

test('writeText updates the editor MODEL, not just the DOM', { skip: !dom.available }, () => {
  const page = dom.createPage(dom.CHATGPT_HTML);
  try {
    const el = page.document.getElementById('prompt-textarea');
    const editor = dom.attachModelEditor(el);
    editor.state = 'Please could you kindly summarize this report for me.';

    assert.strictEqual(C.writeText(el, 'Summarize this report.'), true);
    assert.strictEqual(editor.state, 'Summarize this report.',
      'the model must carry the new prompt — this is what gets sent');
    assert.strictEqual(editor.inSync, true, 'nobody wrote behind the editor’s back');
    assert.strictEqual(C.readText(el), 'Summarize this report.');
    // execCommand is never reached, and must never be: it fires no
    // `beforeinput`, so this editor would not have heard about the change. The
    // editor claimed a `beforeinput` we offered it instead.
    assert.deepStrictEqual(page.commands, []);
  } finally {
    page.restore();
  }
});

test('writeText replaces the whole document, not the first matching text',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.CHATGPT_HTML);
    try {
      const el = page.document.getElementById('prompt-textarea');
      const editor = dom.attachModelEditor(el);
      // Three identical paragraphs: a naive find-and-replace would change one
      // and leave the other two behind.
      editor.state = 'Summarize the report.\nSummarize the report.\nSummarize the report.';

      assert.strictEqual(C.writeText(el, 'Summarize the report once.'), true);
      assert.strictEqual(editor.state, 'Summarize the report once.');
      assert.strictEqual(editor.inSync, true);
    } finally {
      page.restore();
    }
  });

test('writeText handles changes at the start, middle, and end identically',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.CHATGPT_HTML);
    try {
      const el = page.document.getElementById('prompt-textarea');
      const editor = dom.attachModelEditor(el);
      const original = 'Please review the plan. Keep it under 200 words. Thank you so much.';
      const cases = {
        start: 'Review the plan. Keep it under 200 words. Thank you so much.',
        middle: 'Please review the plan. Under 200 words. Thank you so much.',
        end: 'Please review the plan. Keep it under 200 words.',
      };
      for (const [where, next] of Object.entries(cases)) {
        editor.state = original;
        assert.strictEqual(C.writeText(el, next), true, where);
        assert.strictEqual(editor.state, next, `change at the ${where}`);
        assert.strictEqual(editor.inSync, true, where);
      }
    } finally {
      page.restore();
    }
  });

test('writeText preserves multi-line structure in the model', { skip: !dom.available }, () => {
  const page = dom.createPage(dom.CHATGPT_HTML);
  try {
    const el = page.document.getElementById('prompt-textarea');
    const editor = dom.attachModelEditor(el);
    editor.state = 'Intro line.\n\nBody line one.\nBody line two.';
    const next = 'Intro.\n\nBody one.\nBody two.';

    assert.strictEqual(C.writeText(el, next), true);
    assert.strictEqual(editor.state, next);
    assert.strictEqual(C.readText(el), next, 'and it reads back the same way');
  } finally {
    page.restore();
  }
});

test('writeText round-trips long content', { skip: !dom.available }, () => {
  const page = dom.createPage(dom.CHATGPT_HTML);
  try {
    const el = page.document.getElementById('prompt-textarea');
    const editor = dom.attachModelEditor(el);
    editor.state = 'short';
    const long = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} with some content.`).join('\n');

    assert.strictEqual(C.writeText(el, long), true);
    assert.strictEqual(editor.state, long);
    assert.strictEqual(editor.state.length, long.length);
  } finally {
    page.restore();
  }
});

test('writeText clears the composer for an empty replacement', { skip: !dom.available }, () => {
  const page = dom.createPage(dom.CHATGPT_HTML);
  try {
    const el = page.document.getElementById('prompt-textarea');
    const editor = dom.attachModelEditor(el);
    editor.state = 'Something to remove.';

    assert.strictEqual(C.writeText(el, ''), true);
    assert.strictEqual(editor.state, '');
    assert.strictEqual(C.readText(el), '');
  } finally {
    page.restore();
  }
});

test('writeText fails honestly rather than corrupting the editor',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.CHATGPT_HTML);
    try {
      const el = page.document.getElementById('prompt-textarea');
      const editor = dom.attachModelEditor(el);
      editor.detach();                        // nothing claims the edit…
      el.innerHTML = '<p>untouchable</p>';
      page.document.execCommand = () => false;  // …and the native path fails too

      assert.strictEqual(C.writeText(el, 'new text'), false);
      // Crucially it did NOT write the DOM directly. A composer that shows text
      // the editor does not know about is worse than one that did not change.
      assert.strictEqual(C.readText(el), 'untouchable');
    } finally {
      page.restore();
    }
  });

// ── Selection and caret ────────────────────────────────────────────────────

test('writeText leaves a collapsed caret at the end, not a full selection',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.PLAIN_HTML);
    try {
      const el = page.document.getElementById('prompt-box');
      el.innerHTML = '<p>old text here</p>';
      el.focus();
      C.writeText(el, 'brand new text');

      const sel = page.window.getSelection();
      assert.strictEqual(sel.isCollapsed, true,
        'a lingering selection would mean the next keystroke wipes the new text');
      // Anchored in a text node at its end — not on the editable root, which
      // rich editors resolve inconsistently.
      assert.strictEqual(sel.anchorNode.nodeType, 3);
      assert.strictEqual(sel.anchorOffset, (sel.anchorNode.nodeValue || '').length);
    } finally {
      page.restore();
    }
  });

test('selectAllContents anchors on text nodes rather than the editable root',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.CHATGPT_HTML);
    try {
      const el = page.document.getElementById('prompt-textarea');
      el.innerHTML = '<p>first line</p><p>second line</p>';
      const range = C.selectAllContents(el);
      assert.strictEqual(range.startContainer.nodeType, 3, 'start is a text node');
      assert.strictEqual(range.endContainer.nodeType, 3, 'end is a text node');
      assert.strictEqual(range.startOffset, 0);
      assert.strictEqual(range.endContainer.nodeValue, 'second line');
      assert.strictEqual(range.endOffset, 'second line'.length);
    } finally {
      page.restore();
    }
  });

test('writeText puts the textarea caret at the end of the new value',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.TEXTAREA_HTML);
    try {
      const el = page.document.getElementById('prompt-textarea');
      el.value = 'the old and much longer value';
      el.setSelectionRange(4, 12);            // user had a selection
      C.writeText(el, 'short new');
      assert.strictEqual(el.selectionStart, 'short new'.length);
      assert.strictEqual(el.selectionEnd, 'short new'.length);
    } finally {
      page.restore();
    }
  });

test('writeText replaces every occurrence in a textarea with repeated text',
  { skip: !dom.available }, () => {
    const page = dom.createPage(dom.TEXTAREA_HTML);
    try {
      const el = page.document.getElementById('prompt-textarea');
      el.value = 'Do it. Do it. Do it.';
      C.writeText(el, 'Do it once.');
      assert.strictEqual(el.value, 'Do it once.');
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
