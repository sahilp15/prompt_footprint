// Regression suite for the "Replace prompt" append bug.
// ---------------------------------------------------------------------------
// Reported behaviour: clicking Replace prompt left the composer holding
// `originalPrompt + optimizedPrompt` instead of just the optimized one.
//
// Root cause (see lib/editors.js): Lexical and ProseMirror keep their own copy
// of the selection and refresh it from `selectionchange`, which the browser
// delivers asynchronously. Moving the DOM selection and dispatching a synthetic
// `beforeinput` in the same tick therefore handed the editor an insertion while
// it still believed the caret was collapsed at the end of the old prompt.
//
// Every assertion below reads the EDITOR'S MODEL (`editor.state`) — what would
// actually be sent — never the markup, because the failure mode is precisely
// "the box looks right and the model is wrong".

const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/composer.js');
const ED = require('../lib/editors.js');
const dom = require('./helpers/dom.js');

const skip = !dom.available;

const ORIGINAL = 'Write an email to my teacher about the assignment';
const OPTIMIZED = 'Draft a concise email to my teacher asking for clarification about the assignment.';

function withPage(html, fn, url) {
  const page = dom.createPage(html, url ? { url } : undefined);
  try { return fn(page); } finally { page.restore(); }
}

/** The two editors the product actually has to work with. */
const PLATFORMS = [
  { name: 'ChatGPT (Lexical)', html: dom.CHATGPT_HTML, selector: '#prompt-textarea', url: 'https://chatgpt.com/' },
  { name: 'Claude (ProseMirror)', html: dom.CLAUDE_HTML, selector: '.ProseMirror', url: 'https://claude.ai/new' },
];

// ── The reported bug, on both platforms ────────────────────────────────────

for (const platform of PLATFORMS) {
  test(`${platform.name}: replacing a single-line prompt removes the old one`, { skip }, () => {
    withPage(platform.html, (page) => {
      const el = page.document.querySelector(platform.selector);
      const editor = dom.attachModelEditor(el);
      editor.state = ORIGINAL;

      assert.strictEqual(C.writeText(el, OPTIMIZED), true);

      assert.strictEqual(editor.state, OPTIMIZED,
        'the composer must contain ONLY the optimized prompt');
      assert.ok(!editor.state.includes(ORIGINAL),
        'the original prompt must actually be gone');
      assert.strictEqual(editor.state, OPTIMIZED.trim());
      assert.strictEqual(editor.inSync, true, 'nobody wrote behind the editor’s back');
    }, platform.url);
  });

  test(`${platform.name}: the optimized prompt is inserted exactly once`, { skip }, () => {
    withPage(platform.html, (page) => {
      const el = page.document.querySelector(platform.selector);
      const editor = dom.attachModelEditor(el);
      editor.state = ORIGINAL;
      C.writeText(el, OPTIMIZED);

      const occurrences = editor.state.split(OPTIMIZED).length - 1;
      assert.strictEqual(occurrences, 1, `inserted ${occurrences} times`);
      assert.strictEqual(editor.state.length, OPTIMIZED.length);
    }, platform.url);
  });

  test(`${platform.name}: replacing a multi-paragraph prompt`, { skip }, () => {
    withPage(platform.html, (page) => {
      const el = page.document.querySelector(platform.selector);
      const editor = dom.attachModelEditor(el);
      const before = [
        'Hi there! I was wondering if you could help me with something.',
        '',
        'I need a summary of the Q3 2024 report for Northwind Logistics.',
        'Please do not include any financial projections.',
        '',
        'Thank you so much in advance!',
      ].join('\n');
      const after = 'Summarize the Q3 2024 Northwind Logistics report.\n\nExclude financial projections.';
      editor.state = before;

      assert.strictEqual(C.writeText(el, after), true);
      assert.strictEqual(editor.state, after);
      assert.ok(!editor.state.includes('Thank you so much'), 'no remnant of the old prompt');
      assert.strictEqual(editor.state.split('\n').length, 3, 'paragraph structure survives');
      assert.strictEqual(C.readText(el), after, 'and it reads back identically');
    }, platform.url);
  });

  test(`${platform.name}: the host application is told the value changed`, { skip }, () => {
    withPage(platform.html, (page) => {
      const el = page.document.querySelector(platform.selector);
      const editor = dom.attachModelEditor(el);
      editor.state = ORIGINAL;
      const seen = [];
      el.addEventListener('input', () => seen.push(C.readText(el)));

      C.writeText(el, OPTIMIZED);
      assert.ok(seen.length >= 1, 'at least one input event reached the host app');
      assert.strictEqual(seen[seen.length - 1], OPTIMIZED,
        'and the last one carried the new value, not the old');
    }, platform.url);
  });

  test(`${platform.name}: replacing does not submit the message`, { skip }, () => {
    withPage(platform.html, (page) => {
      const el = page.document.querySelector(platform.selector);
      const editor = dom.attachModelEditor(el);
      editor.state = ORIGINAL;

      const submits = [];
      page.document.addEventListener('submit', () => submits.push('submit'));
      page.document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submits.push('enter');
      }, true);
      const send = page.document.querySelector('[data-testid="send-button"], [aria-label="Send message"]');
      if (send) send.addEventListener('click', () => submits.push('send-click'));

      C.writeText(el, OPTIMIZED);
      assert.deepStrictEqual(submits, [], 'a replacement must never send the message');
    }, platform.url);
  });

  test(`${platform.name}: focus stays in the composer with a collapsed caret at the end`,
    { skip }, () => {
      withPage(platform.html, (page) => {
        const el = page.document.querySelector(platform.selector);
        const editor = dom.attachModelEditor(el);
        editor.state = ORIGINAL;
        C.writeText(el, OPTIMIZED);

        assert.strictEqual(page.document.activeElement, el, 'composer keeps focus');
        const sel = page.window.getSelection();
        assert.strictEqual(sel.isCollapsed, true,
          'a lingering selection means the next keystroke wipes the new prompt');
        assert.strictEqual(editor.caretAtEnd, true,
          'the caret the EDITOR believes in is at the end of the new text');
      }, platform.url);
    });

  test(`${platform.name}: optimizing again after an edit still replaces cleanly`, { skip }, () => {
    withPage(platform.html, (page) => {
      const el = page.document.querySelector(platform.selector);
      const editor = dom.attachModelEditor(el);

      // Three full cycles, each one editing the result of the last. The bug got
      // worse with every round, so a single replacement is not enough proof.
      editor.state = ORIGINAL;
      assert.strictEqual(C.writeText(el, OPTIMIZED), true);
      assert.strictEqual(editor.state, OPTIMIZED);

      const edited = `${OPTIMIZED} Keep it under 100 words.`;
      editor.state = edited;                              // the user types more
      const second = 'Email my teacher for clarification on the assignment. Under 100 words.';
      assert.strictEqual(C.writeText(el, second), true);
      assert.strictEqual(editor.state, second);

      editor.state = `${second}\nAlso mention the deadline.`;
      const third = 'Email my teacher about the assignment and the deadline. Under 100 words.';
      assert.strictEqual(C.writeText(el, third), true);
      assert.strictEqual(editor.state, third);
      assert.strictEqual(editor.state.split(/\s+/).length, third.split(/\s+/).length,
        'nothing accumulated across three rounds');
    }, platform.url);
  });
}

// ── Content shapes ─────────────────────────────────────────────────────────

const SHAPES = {
  'one line': 'Summarize this.',
  'thousands of characters': Array.from({ length: 220 },
    (_, i) => `Sentence number ${i} of a very long prompt about logistics.`).join(' '),
  code: 'Refactor this:\n```js\nconst API_KEY = "sk-test-123";\nfetch("https://api.example.com/v1/items?limit=50");\n```\nKeep the API identical.',
  markdown: '# Task\n\n- [ ] Read the **report**\n- [ ] Note `edge cases`\n\n> Quote to keep\n\n| a | b |\n| - | - |\n| 1 | 2 |',
  'emoji and unicode': 'Résumé 📄 — 请总结这份报告 🙏 (naïve façade) ✅ 🇯🇵 𝕌𝕟𝕚𝕔𝕠𝕕𝕖',
  'blank lines': 'First.\n\n\nSecond after two blank lines.',
};

for (const [shape, text] of Object.entries(SHAPES)) {
  test(`replacement round-trips ${shape} exactly`, { skip }, () => {
    withPage(dom.CHATGPT_HTML, (page) => {
      const el = page.document.getElementById('prompt-textarea');
      const editor = dom.attachModelEditor(el);
      editor.state = 'the prompt this replaces';

      assert.strictEqual(C.writeText(el, text), true, shape);
      assert.strictEqual(editor.state, text, shape);
      assert.strictEqual(C.readText(el), text, `${shape} reads back identically`);
    });
  });
}

// ── The test double must be able to SEE the bug ────────────────────────────

test('an edit offered without flushing the selection lands at the stale caret',
  { skip }, () => {
    // This is the old behaviour, reproduced deliberately. If this test ever
    // stops appending, the double has stopped modelling the editors and every
    // other test in this file has quietly become worthless.
    withPage(dom.CHATGPT_HTML, (page) => {
      const el = page.document.getElementById('prompt-textarea');
      const editor = dom.attachModelEditor(el);
      editor.state = ORIGINAL;

      el.focus();
      ED.selectAllContents(el);            // DOM selection covers everything…
      // …but nothing tells the editor, so it still believes the caret is at the
      // end. Exactly the old `writeText`.
      el.dispatchEvent(new page.window.InputEvent('beforeinput', {
        bubbles: true, cancelable: true, composed: true,
        inputType: 'insertText', data: OPTIMIZED,
      }));

      assert.strictEqual(editor.state, ORIGINAL + OPTIMIZED,
        'the reported bug, reproduced: the optimized prompt was appended');
    });
  });

test('flushing the selection is what makes the same edit replace', { skip }, () => {
  withPage(dom.CHATGPT_HTML, (page) => {
    const el = page.document.getElementById('prompt-textarea');
    const editor = dom.attachModelEditor(el);
    editor.state = ORIGINAL;

    el.focus();
    ED.selectAllAndFlush(el);              // the one added call
    el.dispatchEvent(new page.window.InputEvent('beforeinput', {
      bubbles: true, cancelable: true, composed: true,
      inputType: 'insertText', data: OPTIMIZED,
    }));

    assert.strictEqual(editor.state, OPTIMIZED);
  });
});

test('looksAppended recognises the failure it is named after', () => {
  assert.strictEqual(ED.looksAppended(ORIGINAL + OPTIMIZED, ORIGINAL, OPTIMIZED), true);
  assert.strictEqual(ED.looksAppended(`${ORIGINAL}\n${OPTIMIZED}`, ORIGINAL, OPTIMIZED), true);
  assert.strictEqual(ED.looksAppended(OPTIMIZED, ORIGINAL, OPTIMIZED), false);
  assert.strictEqual(ED.looksAppended('', ORIGINAL, OPTIMIZED), false);
  // A replacement that legitimately ends with the old text is not an append.
  assert.strictEqual(ED.looksAppended('Draft it.', 'Draft it.', 'Draft it.'), false);
});

// ── Degraded environments ──────────────────────────────────────────────────

test('replacement still works when execCommand is unavailable', { skip }, () => {
  withPage(dom.CHATGPT_HTML, (page) => {
    const el = page.document.getElementById('prompt-textarea');
    const editor = dom.attachModelEditor(el);
    editor.state = ORIGINAL;
    page.window.__pfNoExecCommand = true;      // as if the command were removed

    const result = C.replaceText(el, OPTIMIZED);
    assert.strictEqual(result.ok, true);
    assert.notStrictEqual(result.strategy, 'native-command',
      'a synthetic strategy must have carried it');
    assert.strictEqual(editor.state, OPTIMIZED);
  });
});

test('an editor that ignores every selection signal never leaves a duplicate',
  { skip }, () => {
    // The worst case: an editor that neither listens for `selectionchange` nor
    // reads target ranges, so no event we dispatch can be placed correctly.
    //
    // The guarantee is NOT that the replacement succeeds. It is that the user is
    // never left holding two prompts — every append is detected and undone
    // before anything else is tried — and that a result the editor did not claim
    // is reported as unverified so the caller re-checks it.
    withPage(dom.CHATGPT_HTML, (page) => {
      const el = page.document.getElementById('prompt-textarea');
      const editor = dom.attachModelEditor(el, {
        ignoreSelectionChange: true, ignoreTargetRanges: true,
      });
      editor.state = ORIGINAL;

      const result = C.replaceText(el, OPTIMIZED);
      assert.strictEqual(result.appended, true, 'the editor did append, and we saw it');
      assert.strictEqual(result.verified, false,
        'a result nothing claimed is never reported as verified');
      // The one thing that must never happen, in either the DOM or the model.
      assert.ok(!C.readText(el).startsWith(ORIGINAL),
        `composer holds a doubled prompt: ${JSON.stringify(C.readText(el).slice(0, 60))}`);
      assert.ok(!editor.state.startsWith(`${ORIGINAL}${OPTIMIZED}`),
        'the editor model must not hold original + optimized either');
    });
  });

test('an unclaimed write is flagged so the caller verifies it', { skip }, () => {
  // A Lexical-shaped element that nobody is listening on. The DOM ends up
  // correct, but nothing confirmed it, so the result says so — which is what
  // makes the assistant schedule its verification pass.
  withPage(dom.CHATGPT_HTML, (page) => {
    const el = page.document.getElementById('prompt-textarea');
    el.innerHTML = `<p>${ORIGINAL}</p>`;
    el.focus();
    const result = C.replaceText(el, OPTIMIZED);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.verified, false);
    assert.strictEqual(result.unclaimed, true);
    assert.strictEqual(C.readText(el), OPTIMIZED);
  });
});

test('verify repairs an editor that reconciled to the wrong content', { skip }, () => {
  withPage(dom.CHATGPT_HTML, (page) => {
    const el = page.document.getElementById('prompt-textarea');
    const editor = dom.attachModelEditor(el);
    editor.state = ORIGINAL;
    C.writeText(el, OPTIMIZED);

    // Simulate an editor that committed asynchronously and got it wrong.
    editor.state = ORIGINAL + OPTIMIZED;

    const check = C.verifyText(el, OPTIMIZED);
    assert.strictEqual(check.ok, true);
    assert.strictEqual(check.repaired, true);
    assert.strictEqual(editor.state, OPTIMIZED);
  });
});

test('verify is a cheap no-op when the composer is already correct', { skip }, () => {
  withPage(dom.CHATGPT_HTML, (page) => {
    const el = page.document.getElementById('prompt-textarea');
    const editor = dom.attachModelEditor(el);
    editor.state = OPTIMIZED;
    page.commands.length = 0;

    const check = C.verifyText(el, OPTIMIZED);
    assert.strictEqual(check.ok, true);
    assert.strictEqual(check.repaired, false);
    assert.deepStrictEqual(page.commands, [], 'nothing was written');
  });
});

// ── Plain textarea composers ───────────────────────────────────────────────

test('textarea: a single-line prompt is replaced, not appended', { skip }, () => {
  withPage(dom.TEXTAREA_HTML, (page) => {
    const el = page.document.getElementById('prompt-textarea');
    el.value = ORIGINAL;
    assert.strictEqual(C.writeText(el, OPTIMIZED), true);
    assert.strictEqual(el.value, OPTIMIZED);
  });
});

test('textarea: a multi-line prompt is replaced wholesale', { skip }, () => {
  withPage(dom.TEXTAREA_HTML, (page) => {
    const el = page.document.getElementById('prompt-textarea');
    el.value = 'Line one.\nLine two.\n\nLine four.';
    const next = 'One.\nTwo.\n\nFour.';
    assert.strictEqual(C.writeText(el, next), true);
    assert.strictEqual(el.value, next);
    assert.strictEqual(el.selectionStart, next.length, 'caret at the end');
  });
});

test('textarea: React is told through the native value setter', { skip }, () => {
  withPage(dom.TEXTAREA_HTML, (page) => {
    const el = page.document.getElementById('prompt-textarea');
    el.value = ORIGINAL;
    // React attaches a value tracker to the node; a plain assignment leaves it
    // in step and onChange never fires. Simulate the tracker and prove the
    // native setter defeated it.
    let trackerSaw = null;
    el.addEventListener('input', () => { trackerSaw = el.value; });

    C.writeText(el, OPTIMIZED);
    assert.strictEqual(trackerSaw, OPTIMIZED);
  });
});

// ── Editor identification ──────────────────────────────────────────────────

test('editors are identified by their own contract attributes', { skip }, () => {
  withPage(dom.CHATGPT_HTML, (page) => {
    assert.strictEqual(ED.editorKind(page.document.getElementById('prompt-textarea')), 'lexical');
  });
  withPage(dom.CLAUDE_HTML, (page) => {
    assert.strictEqual(ED.editorKind(page.document.querySelector('.ProseMirror')), 'prosemirror');
  }, 'https://claude.ai/new');
  withPage(dom.TEXTAREA_HTML, (page) => {
    assert.strictEqual(ED.editorKind(page.document.getElementById('prompt-textarea')), 'input');
  });
});

test('a model-owning editor is recognised as one', () => {
  assert.strictEqual(ED.ownsModel('lexical'), true);
  assert.strictEqual(ED.ownsModel('prosemirror'), true);
  assert.strictEqual(ED.ownsModel('input'), false);
  assert.strictEqual(ED.ownsModel('contenteditable'), false);
});
