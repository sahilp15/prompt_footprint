// PromptFootprint Editor Abstraction
// ---------------------------------------------------------------------------
// "Put exactly this text in the composer, replacing whatever is there" — for
// every kind of editor the supported chat products actually ship.
//
// THE BUG THIS FILE EXISTS TO FIX
//
// ChatGPT's composer is Lexical; Claude's is ProseMirror. Neither treats the DOM
// as the source of truth: each keeps its own document model AND ITS OWN COPY OF
// THE SELECTION. That second half is the part that was missed.
//
// Those editors do not read `window.getSelection()` while handling an edit. They
// read a selection they cached earlier, and they refresh that cache when the
// browser delivers a `selectionchange` event — which is dispatched
// ASYNCHRONOUSLY, at the end of the task, never inline with the assignment.
//
// So the old sequence
//
//     selectAllContents(el);                       // DOM selection = everything
//     el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText' }));
//
// handed the editor an "insert this text" instruction while the editor still
// believed the caret was collapsed at the end of the existing prompt. It
// inserted there. The result was `oldPrompt + optimizedPrompt` — the exact
// append the user reported. And because the editor called `preventDefault()`,
// `dispatchEvent` returned false, which the old code read as "success", so
// nothing ever noticed.
//
// Synthetic InputEvents make this unfixable from the event alone: the browser
// populates `getTargetRanges()` only for trusted events, so a hand-built
// `beforeinput` carries no ranges and the editor has nothing to fall back on
// except the stale cache.
//
// THE FIX, in three parts
//
//   1. FLUSH THE SELECTION. After moving the DOM selection, dispatch
//      `selectionchange` on the document synchronously. Lexical and ProseMirror
//      both subscribe to it, so this is the supported way to make them adopt a
//      selection we just set — the same event they would receive a moment later
//      anyway.
//   2. NEVER LET `execCommand` NEAR A MODEL-OWNING EDITOR. Measured in Chromium
//      139 against a Lexical-shaped fixture: `document.execCommand('insertText')`
//      edits the DOM, fires `input`, RETURNS TRUE — and dispatches no
//      `beforeinput` whatsoever, from the page's own world or from a content
//      script. So the box shows the new prompt, the editor's model still holds
//      the old one, and Send transmits the old one. Its return value proves
//      nothing. It is therefore offered only to editors that have declined every
//      event-based strategy, which is the signature of a plain contenteditable
//      with no model to desynchronize.
//   3. VERIFY, AND REPAIR. Every strategy is checked by reading the editor back.
//      A result that appended, duplicated, or half-applied is not "success with
//      a caveat" — the composer is cleared and the next strategy runs on a clean
//      editor. If every strategy fails, the original text is restored and the
//      caller is told honestly that it could not write.
//
// Direct DOM writing (`textContent` / `innerHTML`) is deliberately NOT a
// strategy. It is the one approach guaranteed to desynchronize a model-owning
// editor: the box shows the new prompt and Send transmits the old one.

(function (root) {
  'use strict';

  /** Editors that keep their own document model; the DOM is only a rendering. */
  const MODEL_OWNING = new Set(['lexical', 'prosemirror', 'quill']);

  // ── Identification ────────────────────────────────────────────────────────

  /**
   * Which kind of editor this element is.
   *
   * Matched on the editors' own contract attributes (`data-lexical-editor`, the
   * `ProseMirror` class, Quill's `ql-editor`) rather than on product-specific
   * markup, so a ChatGPT or Claude redesign that keeps its editor keeps working.
   * An unrecognised contenteditable is handled as a plain one, which is the
   * correct conservative default: plain handling on a model-owning editor still
   * goes through `beforeinput`, it just tries the strategies in a different
   * order.
   */
  function editorKind(el) {
    if (!el) return 'none';
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') return 'input';
    const has = (sel) => {
      try { return !!(el.matches?.(sel) || el.closest?.(sel)); } catch (_) { return false; }
    };
    if (has('[data-lexical-editor]')) return 'lexical';
    if (has('.ProseMirror')) return 'prosemirror';
    if (has('.ql-editor')) return 'quill';
    const attr = el.getAttribute?.('contenteditable');
    if (el.isContentEditable === true || ['', 'true', 'plaintext-only'].includes(attr)) {
      return 'contenteditable';
    }
    return 'unknown';
  }

  function ownsModel(kind) { return MODEL_OWNING.has(kind); }

  // ── Text comparison ───────────────────────────────────────────────────────

  /**
   * Line endings and trailing whitespace are the editor's business, not ours.
   *
   * Deliberately does NOT collapse runs of whitespace: `a\n\nb` and `a b` are
   * different prompts, and treating them as equal would let a half-applied write
   * pass verification.
   */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function sameText(a, b) { return normalize(a) === normalize(b); }

  /**
   * The signature of the bug: the new text arrived, but the old text is still in
   * front of it. Reported separately from "wrong content" because it is the one
   * failure mode worth naming in a log — it means an editor applied our edit at
   * a stale caret.
   */
  function looksAppended(after, before, value) {
    const a = normalize(after);
    const b = normalize(before);
    const v = normalize(value);
    if (!v || a === v) return false;
    if (b && a === b + v) return true;
    if (b && a === `${b}\n${v}`) return true;
    return !!(b && a.length > v.length && a.endsWith(v) && a.startsWith(b));
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  /**
   * Select an editable's entire contents and return the Range.
   *
   * Anchored on the first and last TEXT NODES rather than on the editable root:
   * a range whose container is the root points at a child index, not a text
   * position, and editors that map DOM selections onto their own model resolve
   * that inconsistently. Text-node anchoring produces exactly what Ctrl+A does.
   */
  function selectAllContents(el) {
    const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const view = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
    const selection = view && view.getSelection ? view.getSelection() : null;
    if (!selection || !doc) return null;
    const range = doc.createRange();
    let first = null;
    let last = null;
    try {
      const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
      let node;
      while ((node = walker.nextNode())) {
        if (!first) first = node;
        last = node;
      }
    } catch (_) { /* no TreeWalker — fall back below */ }
    try {
      if (first && last) {
        range.setStart(first, 0);
        range.setEnd(last, (last.nodeValue || '').length);
      } else {
        range.selectNodeContents(el);          // genuinely empty editor
      }
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_) { return null; }
    return range;
  }

  /**
   * Tell the host editor that the selection moved. THE LOAD-BEARING CALL.
   *
   * Lexical registers `document.addEventListener('selectionchange', …)` and
   * ProseMirror's DOM observer registers the same listener on the editable's
   * owner document; both use it to re-read the DOM selection into their internal
   * model. The browser would deliver this event by itself — but only after the
   * current task, which is far too late for an edit we are about to dispatch
   * synchronously. Dispatching it here is not a trick: it is the same
   * notification, delivered at the moment the selection actually changed.
   *
   * Also fired on the element for editors that scope the listener to their own
   * root, and on the window for the handful that listen there.
   */
  function flushSelection(el) {
    const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const view = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
    const fire = (target, bubbles) => {
      if (!target || !target.dispatchEvent) return;
      try { target.dispatchEvent(new Event('selectionchange', { bubbles: !!bubbles })); } catch (_) { /* optional */ }
    };
    fire(doc, false);
    fire(el, true);
    fire(view, false);
  }

  /** Put the caret at the end of the editable's text. */
  function collapseToEnd(el) {
    const doc = el.ownerDocument || document;
    const view = doc.defaultView || window;
    const selection = view.getSelection && view.getSelection();
    if (!selection) return;
    try {
      const range = doc.createRange();
      let last = null;
      try {
        const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
        let node;
        while ((node = walker.nextNode())) last = node;
      } catch (_) { /* fall back to the element below */ }
      if (last) {
        range.setStart(last, (last.nodeValue || '').length);
        range.collapse(true);
      } else {
        range.selectNodeContents(el);
        range.collapse(false);
      }
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_) { /* selection is a nicety, never a failure */ }
    flushSelection(el);
  }

  /**
   * Leave a usable caret behind after a write.
   *
   * An editor that applied the change itself has already placed its caret and
   * knows better than we do, so we only step in when the selection is still
   * spanning content — which would mean the user's next keystroke wipes the text
   * we just inserted.
   */
  function ensureCaret(el) {
    const doc = el.ownerDocument || document;
    const view = (doc && doc.defaultView) || window;
    const selection = view.getSelection && view.getSelection();
    if (selection && selection.isCollapsed) return;
    collapseToEnd(el);
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  // Block-level tags whose boundaries are line breaks in the user's prompt.
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'BR', 'PRE', 'BLOCKQUOTE',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'SECTION', 'ARTICLE',
  ]);

  /**
   * Plain text of an editable element, with line breaks preserved.
   *
   * `textContent` is wrong here: Lexical and ProseMirror render each line as its
   * own <p>, so `textContent` silently glues paragraphs together — a multi-line
   * prompt would be analyzed, and could be replaced, as one run-on line.
   */
  function readText(el) {
    if (!el) return '';
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') return el.value || '';
    const out = [];
    const walk = (node) => {
      const children = node.childNodes || [];
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        if (child.nodeType === 3) {                        // text
          out.push(child.nodeValue || '');
          continue;
        }
        if (child.nodeType !== 1) continue;                // element only
        if (child.tagName === 'BR') {
          // Lexical and ProseMirror render an EMPTY line as `<p><br></p>`: the
          // <br> is there to give the block a height, not to break a line. The
          // block's own boundary already contributes that newline, so counting
          // the <br> as well turns every blank line in a prompt into two — which
          // is how a multi-paragraph prompt came back with its spacing doubled.
          const closesBlock = i === children.length - 1 && BLOCK_TAGS.has(node.tagName);
          if (!closesBlock) out.push('\n');
          continue;
        }
        const block = BLOCK_TAGS.has(child.tagName);
        if (block && out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
        walk(child);
        if (block) out.push('\n');
      }
    };
    walk(el);
    // A trailing newline is an artifact of the final block, not user content.
    return out.join('').replace(/\n+$/, '');
  }

  // ── Writing primitives ────────────────────────────────────────────────────

  // React tracks the value it last rendered on the DOM node itself. Assigning
  // `el.value = x` updates the node but leaves that tracker in step, so React's
  // onChange never fires and its state silently diverges from what the user
  // sees. Going through the prototype's native setter defeats the tracker,
  // which is the documented way to drive a controlled input from outside React.
  function setNativeValue(el, value) {
    const view = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const Ctor = String(el.tagName || '').toUpperCase() === 'TEXTAREA'
      ? (view && view.HTMLTextAreaElement) || (typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement : null)
      : (view && view.HTMLInputElement) || (typeof HTMLInputElement !== 'undefined' ? HTMLInputElement : null);
    const desc = Ctor && Object.getOwnPropertyDescriptor(Ctor.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function makeDataTransfer(el, value) {
    const view = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const DT = (view && view.DataTransfer) || (typeof DataTransfer !== 'undefined' ? DataTransfer : null);
    if (!DT) return null;
    try {
      const dt = new DT();
      dt.setData('text/plain', value);
      return dt;
    } catch (_) { return null; }
  }

  /** Dispatch a beforeinput; returns true when a listener claimed it. */
  function offerBeforeInput(el, init) {
    const view = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const IE = (view && view.InputEvent) || (typeof InputEvent !== 'undefined' ? InputEvent : null);
    if (!IE) return false;
    try {
      return !el.dispatchEvent(new IE('beforeinput', {
        bubbles: true, cancelable: true, composed: true, ...init,
      }));
    } catch (_) { return false; }
  }

  function notifyInput(el, inputType, data) {
    const view = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const IE = (view && view.InputEvent) || (typeof InputEvent !== 'undefined' ? InputEvent : null);
    const Ev = (view && view.Event) || (typeof Event !== 'undefined' ? Event : null);
    try {
      if (IE) el.dispatchEvent(new IE('input', { bubbles: true, composed: true, inputType, data }));
      else if (Ev) el.dispatchEvent(new Ev('input', { bubbles: true }));
    } catch (_) { /* best effort */ }
  }

  /** Select everything, then make sure the editor has adopted that selection. */
  function selectAllAndFlush(el) {
    const range = selectAllContents(el);
    flushSelection(el);
    return range;
  }

  /**
   * Empty the editor through its own machinery.
   *
   * Used both as the empty-string write and as the repair step between failed
   * strategies: a strategy that appended must not leave its damage behind for
   * the next one to append to as well.
   */
  function clearAll(el, opts) {
    const doc = el.ownerDocument || document;
    const allowNative = !(opts && opts.eventsOnly);
    if (!readText(el)) return true;

    if (allowNative) {
      selectAllAndFlush(el);
      try { doc.execCommand('delete', false); } catch (_) { /* try the next one */ }
      if (!readText(el)) return true;
    }

    selectAllAndFlush(el);
    if (offerBeforeInput(el, { inputType: 'deleteContentBackward', data: null })) {
      if (!readText(el)) return true;
    }

    selectAllAndFlush(el);
    if (offerBeforeInput(el, { inputType: 'insertReplacementText', data: '', dataTransfer: makeDataTransfer(el, '') })) {
      if (!readText(el)) return true;
    }
    return !readText(el);
  }

  /**
   * Ask the editor to undo its last change.
   *
   * The one repair that does NOT depend on the selection — which matters,
   * because we only ever need a repair when the selection has just proven
   * unreliable. Lexical and ProseMirror both implement `historyUndo`, and both
   * apply it to their own history stack rather than to a caret position.
   */
  function undoLast(el) {
    return offerBeforeInput(el, { inputType: 'historyUndo', data: null });
  }

  /**
   * Put `before` back after a strategy went wrong.
   *
   * Ordered so the least selection-dependent mechanism goes first. Returns false
   * when the editor is genuinely beyond reach, which is the caller's signal to
   * STOP — running another strategy on a composer we cannot reset is how one
   * bad append becomes four.
   */
  function restoreTo(el, before, opts) {
    if (sameText(readText(el), before)) return true;
    const doc = el.ownerDocument || document;
    const eventsOnly = !!(opts && opts.eventsOnly);

    for (let i = 0; i < 4; i += 1) {
      if (!undoLast(el)) break;
      if (sameText(readText(el), before)) return true;
    }

    if (clearAll(el, opts)) {
      if (!before) return true;
      selectAllAndFlush(el);
      offerBeforeInput(el, { inputType: 'insertText', data: before });
      if (sameText(readText(el), before)) return true;
      if (!eventsOnly) {
        selectAllAndFlush(el);
        try { doc.execCommand('insertText', false, before); } catch (_) { /* nothing left */ }
        if (sameText(readText(el), before)) return true;
      }
    }
    return false;
  }

  // ── Strategies ────────────────────────────────────────────────────────────
  //
  // Every strategy has the same contract: the selection already covers the whole
  // editor and the editor has been told about it. Return `true` if the edit was
  // at least attempted (claimed by a listener or applied natively) — never
  // whether it produced the right text. Verification is the caller's job, once,
  // in one place.

  const STRATEGIES = [
    {
      // The browser's own editing command. Correct for a plain contenteditable
      // and ONLY for a plain contenteditable: it does not fire `beforeinput`, so
      // an editor with its own document model never hears about it. See the
      // header. `strategiesFor` keeps it away from those editors entirely, and
      // `replaceAll` refuses a DOM-only match on them as a second guard.
      id: 'native-command',
      // Its return value says "the command ran", NOT "an editor took ownership
      // of the change" — the distinction the rest of this file turns on, since
      // it fires no `beforeinput` for anyone to take ownership through.
      claimsEdit: false,
      run(el, value) {
        const doc = el.ownerDocument || document;
        try { return !!doc.execCommand('insertText', false, value); } catch (_) { return false; }
      },
    },
    {
      // "These characters become that text." The most precise statement of
      // intent, and it carries no clipboard semantics, so editors that transform
      // pasted content (markdown, smart quotes) leave ours alone.
      id: 'insert-replacement',
      run(el, value) {
        return offerBeforeInput(el, {
          inputType: 'insertReplacementText',
          data: value,
          dataTransfer: makeDataTransfer(el, value),
        });
      },
    },
    {
      // ProseMirror-family editors handle `paste` explicitly even where they
      // ignore a synthetic beforeinput.
      id: 'paste-event',
      run(el, value) {
        const view = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
        const CE = (view && view.ClipboardEvent) || (typeof ClipboardEvent !== 'undefined' ? ClipboardEvent : null);
        const dt = makeDataTransfer(el, value);
        if (!CE || !dt) return false;
        try {
          return !el.dispatchEvent(new CE('paste', {
            bubbles: true, cancelable: true, composed: true, clipboardData: dt,
          }));
        } catch (_) { return false; }
      },
    },
    {
      id: 'insert-text',
      run(el, value) {
        return offerBeforeInput(el, { inputType: 'insertText', data: value });
      },
    },
    {
      // Last resort, and the only one that states the deletion separately. Some
      // editors treat a replacement of a full-document selection as a no-op but
      // handle an explicit delete followed by an insert at the resulting empty
      // caret. The flush between the two halves is essential: the delete moves
      // the editor's caret, and the insert must land on the new position.
      id: 'delete-then-insert',
      run(el, value, opts) {
        if (!clearAll(el, opts)) return false;
        selectAllAndFlush(el);
        return offerBeforeInput(el, { inputType: 'insertText', data: value });
      },
    },
  ];

  /**
   * Strategy order for this editor.
   *
   * The split that matters: an editor with its own document model is only ever
   * offered strategies it can DECLINE. Every one of them is an event the editor
   * either claims (by calling `preventDefault`, which is it saying "I have
   * applied this to my model") or ignores. `execCommand` is not such a
   * strategy — it edits the DOM whatever the editor thinks — so it is not on
   * their list at all.
   *
   * A plain contenteditable has no model to desynchronize, so it gets the
   * native command as a genuine fallback after the events have gone unclaimed.
   */
  function strategiesFor(kind) {
    const byId = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]));
    const order = {
      // Lexical handles `insertReplacementText` in its own beforeinput listener
      // and applies it through its editor state.
      lexical: ['insert-replacement', 'paste-event', 'insert-text', 'delete-then-insert', 'native-command'],
      // ProseMirror handles `paste` explicitly and largely ignores synthetic
      // beforeinput, so the clipboard path leads here. It also reconciles
      // unexpected DOM mutations by re-parsing them, which is why the native
      // command is still worth a try at the very end for this one.
      prosemirror: ['paste-event', 'insert-replacement', 'insert-text', 'delete-then-insert', 'native-command'],
      // Quill's Delta model is driven most reliably from a clipboard payload.
      quill: ['paste-event', 'insert-replacement', 'insert-text', 'delete-then-insert', 'native-command'],
    }[kind] || [
      // Unknown or plain contenteditable: still try the events first, because an
      // editor we failed to identify by attribute is far more likely than a
      // genuinely plain box, and an unclaimed event costs nothing.
      'insert-replacement', 'paste-event', 'insert-text', 'native-command', 'delete-then-insert',
    ];
    return order.map((id) => byId[id]);
  }

  // ── The public write ──────────────────────────────────────────────────────

  /**
   * Replace the composer's ENTIRE contents with `value`.
   *
   * Returns `{ ok, kind, strategy, verified, appended }`.
   *
   *   ok        the editor now holds `value` (or is believed to — see `verified`)
   *   verified  the editor was read back and matched. `false` means a listener
   *             claimed the edit but has not reconciled its DOM yet, which is
   *             legitimate for editors that commit in a microtask — the caller
   *             should re-check shortly (see `verify`).
   *   appended  at least one strategy produced `old + new`. Kept for logging:
   *             it is the signature of an editor working from a stale caret.
   */
  function replaceAll(el, text, opts) {
    const options = opts || {};
    if (!el) return { ok: false, kind: 'none', strategy: null, verified: false, appended: false };
    const value = typeof text === 'string' ? text : '';
    const kind = editorKind(el);

    if (kind === 'input') return writeInput(el, value);

    const before = readText(el);
    // Nothing to do — and returning early means a no-op replacement can never be
    // reported as a failure, or trigger a repair on a composer that is correct.
    if (sameText(before, value) && value !== '') {
      ensureCaret(el);
      return { ok: true, kind, strategy: 'already-correct', verified: true, appended: false };
    }

    try { el.focus(); } catch (_) { /* focus is best effort */ }

    // Repairs on a model-owning editor use only mechanisms it can decline: a
    // repair exists because something already desynchronized, and `execCommand`
    // cannot un-desynchronize anything. (The strategy list still ends with the
    // native command for these editors — as a last resort whose result is
    // reported unverified, never as a repair.)
    const policy = { eventsOnly: ownsModel(kind) };

    if (!value) {
      const cleared = clearAll(el, policy);
      if (cleared) notifyInput(el, 'deleteContentBackward', null);
      return { ok: cleared, kind, strategy: 'clear', verified: cleared, appended: false };
    }

    let appended = false;
    for (const strategy of strategiesFor(kind)) {
      if (!strategy) continue;
      if (!selectAllAndFlush(el)) break;       // no selection engine: give up cleanly

      let ran = false;
      try { ran = !!strategy.run(el, value, policy); } catch (_) { ran = false; }
      // "Claimed" means a listener called preventDefault — the editor saying it
      // has applied the change to its own model. A strategy that merely edits
      // the DOM (`native-command`) never claims anything, whatever it returns.
      const claimed = ran && strategy.claimsEdit !== false;

      const after = readText(el);
      if (sameText(after, value)) {
        // The text is right. On an editor that owns its model, though, "the DOM
        // is right" is not the same as "the message that will be sent is right":
        // an unclaimed edit means the DOM changed without the editor knowing,
        // which is the failure this whole file exists to prevent.
        //
        // It is reported as UNVERIFIED rather than refused, because the two
        // editors behave differently and both behaviours are recoverable:
        // ProseMirror re-parses unexpected DOM mutations and adopts them, so
        // this genuinely worked; Lexical reverts them from its model within a
        // tick, so `verify()` will see the old text come back and can retry.
        // Refusing outright would break the first case to protect the second.
        const unclaimed = ownsModel(kind) && !claimed;
        if (unclaimed && options.log) {
          options.log(`editors: ${strategy.id} changed the DOM without the editor claiming it — will verify`);
        }
        ensureCaret(el);
        return {
          ok: true, kind, strategy: strategy.id, verified: !unclaimed, appended, unclaimed,
        };
      }

      if (claimed && sameText(after, before)) {
        // A listener took the edit and has not reconciled the DOM yet. Believed,
        // but not verified: the caller re-checks on the next tick.
        ensureCaret(el);
        return { ok: true, kind, strategy: strategy.id, verified: false, appended };
      }

      // Wrong content: appended at a stale caret, half-applied, or mangled. The
      // editor's state must be reset before anything else is tried, and if it
      // CANNOT be reset then trying anything else is how one bad append becomes
      // four. That is not a hypothetical — it is what this loop did before the
      // abort below existed.
      const didAppend = looksAppended(after, before, value);
      if (didAppend) {
        appended = true;
        if (options.log) options.log(`editors: ${strategy.id} appended instead of replacing`);
      }
      if (!sameText(after, before) && !restoreTo(el, before, policy)) {
        return { ok: false, kind, strategy: null, verified: false, appended, damaged: true };
      }
    }

    // Nothing worked. Put the user's prompt back — losing it would be far worse
    // than failing to optimize it — and say so.
    const restored = restoreTo(el, before, policy);
    return { ok: false, kind, strategy: null, verified: false, appended, damaged: !restored };
  }

  /** `<textarea>` / `<input>`: the value setter plus the events React needs. */
  function writeInput(el, value) {
    const view = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const Ev = (view && view.Event) || (typeof Event !== 'undefined' ? Event : null);
    setNativeValue(el, value);
    try {
      notifyInput(el, value ? 'insertReplacementText' : 'deleteContentBackward', value || null);
      if (Ev) el.dispatchEvent(new Ev('change', { bubbles: true }));
    } catch (_) { /* the value is already set; events are the notification */ }
    // Caret to the end of the new text: the whole field was replaced, so an old
    // offset no longer refers to anything, and end-of-text is where the user
    // continues typing or presses send.
    try { el.setSelectionRange(value.length, value.length); } catch (_) { /* not selectable */ }
    const ok = (el.value || '') === value;
    return { ok, kind: 'input', strategy: 'native-value-setter', verified: ok, appended: false };
  }

  /**
   * Re-check a write that reported `verified: false`, and repair it if the
   * editor's reconciliation produced something other than what we asked for.
   *
   * This is the async half of the guarantee. `replaceAll` cannot see what an
   * editor that commits in a microtask will render; this can, because the caller
   * runs it after that microtask has drained.
   */
  function verify(el, text, opts) {
    const value = typeof text === 'string' ? text : '';
    if (!el || !el.isConnected) return { ok: false, repaired: false, reason: 'detached' };
    const current = readText(el);
    if (sameText(current, value)) return { ok: true, repaired: false, reason: 'matched' };
    const result = replaceAll(el, value, opts);
    return { ok: result.ok, repaired: result.ok, reason: result.ok ? 'repaired' : 'failed' };
  }

  const PFEditors = {
    MODEL_OWNING,
    STRATEGIES,
    editorKind,
    ownsModel,
    normalize,
    sameText,
    looksAppended,
    selectAllContents,
    selectAllAndFlush,
    flushSelection,
    collapseToEnd,
    ensureCaret,
    readText,
    setNativeValue,
    clearAll,
    replaceAll,
    verify,
  };

  if (root) root.PFEditors = PFEditors;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFEditors;
})(typeof self !== 'undefined' ? self : this);
