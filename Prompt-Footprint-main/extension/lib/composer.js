// PromptFootprint Composer Detection
// ---------------------------------------------------------------------------
// Finding "the box the user types their prompt into" on a live React app is the
// single most fragile thing this extension does. ChatGPT has shipped a textarea,
// a Lexical contenteditable, and several markup shapes in between; Claude uses
// ProseMirror. One CSS selector is guaranteed to break.
//
// So detection is EVIDENCE-BASED rather than selector-based. Every plausible
// editable element on the page is described as a plain object (tag, editability,
// role, labels, geometry, whether a send control sits nearby, …) and scored. The
// highest-scoring candidate above a confidence floor wins; if nothing clears the
// floor we report "no composer" and the UI stays out of the way instead of
// attaching itself to the wrong element.
//
// The split is deliberate:
//   • `scoreCandidate` / `pickBest` are pure functions over descriptors — no DOM,
//     unit-testable under Node, and where the actual detection rules live.
//   • `describe` / `findComposer` are the thin DOM layer that produces
//     descriptors.
//
// Reading and writing text is also here, because "how do I get text out of this
// element" and "how do I put text back so the app notices" are properties of the
// same detection. A textarea needs the native value setter; a contenteditable
// belonging to Lexical or ProseMirror needs the edit OFFERED to the editor as a
// cancelable event, because those editors send their own document model rather
// than the markup. See `writeText` — that distinction is the whole reason this
// file exists rather than a one-line `el.textContent = …`.

(function (root) {
  'use strict';

  // Elements worth considering at all. Deliberately narrow: this is the only
  // DOM query detection runs, so it must stay cheap enough to call on a
  // mutation burst.
  const CANDIDATE_SELECTOR = [
    'textarea',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[contenteditable="plaintext-only"]',
    '[role="textbox"]',
  ].join(', ');

  // Controls that mean "this container submits a message". Their presence near a
  // candidate is the strongest platform-independent signal we have.
  const SEND_SELECTOR = [
    'button[data-testid="send-button"]',
    '#composer-submit-button',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Submit" i]',
    'button[type="submit"]',
    'button[data-testid="stop-button"]',
    'button[aria-label*="Stop" i]',
  ].join(', ');

  // Words that appear in the placeholder / aria-label of a chat composer across
  // ChatGPT, Claude, and most look-alikes. Matched case-insensitively against
  // the concatenated label text.
  const PROMPT_WORDS = [
    'message', 'ask anything', 'ask ', 'prompt', 'send a message',
    'how can i help', 'reply', 'write', 'type', 'talk to', 'chat',
  ];

  // Labels that mean "this is some OTHER text box" — search fields, titles,
  // renaming inputs. A match is a hard veto: better no assistant than an
  // assistant attached to the search bar.
  const NEGATIVE_WORDS = [
    'search', 'find', 'filter', 'rename', 'title', 'name your', 'url',
    'email', 'password', 'comment on', 'feedback',
  ];

  // Confidence floor. Set so that being editable and roughly the right shape is
  // never enough on its own — at least one corroborating signal (a send control,
  // a known editor, a prompt-like label, the adapter's selector) is required
  // before we attach to something.
  const MIN_SCORE = 6;
  const MIN_WIDTH = 120;    // px — narrower than this is not a prompt box
  const MIN_HEIGHT = 18;

  // ── Pure scoring ──────────────────────────────────────────────────────────

  /**
   * Score one candidate descriptor. Returns 0 for anything disqualified, so the
   * caller can treat "0" as "not a composer" without a second predicate.
   *
   * A descriptor is a plain object; `describe()` builds one from a DOM element,
   * and tests build them by hand:
   *   { tag, isContentEditable, role, type, disabled, readOnly, visible,
   *     width, height, viewportHeight, top, label, matchesAdapter,
   *     hasNearbySend, inForm, editorHint, insideOwnUi }
   */
  function scoreCandidate(d) {
    if (!d) return 0;
    if (d.insideOwnUi) return 0;                       // never target our own UI
    if (d.disabled || d.readOnly) return 0;
    if (d.visible === false) return 0;
    if ((d.width || 0) < MIN_WIDTH) return 0;
    if ((d.height || 0) < MIN_HEIGHT) return 0;

    const tag = (d.tag || '').toLowerCase();
    const editable = d.isContentEditable === true;
    // A textarea, or something explicitly editable. An <input type="text"> is
    // deliberately excluded: single-line inputs on these pages are searches and
    // rename fields, never the prompt box.
    if (tag !== 'textarea' && !editable && d.role !== 'textbox') return 0;

    const label = (d.label || '').toLowerCase();
    if (NEGATIVE_WORDS.some((w) => label.includes(w))) return 0;

    let score = 0;
    if (tag === 'textarea') score += 3;
    if (editable) score += 3;
    if (d.role === 'textbox') score += 2;
    // Known editor implementations (Lexical on ChatGPT, ProseMirror on Claude,
    // `#prompt-textarea`). A hint is strong evidence but never the only one.
    if (d.editorHint) score += 4;
    // The platform adapter's own selector matched. Same status as an editor
    // hint: corroborating, not required.
    if (d.matchesAdapter) score += 4;
    if (d.hasNearbySend) score += 4;
    if (d.inForm) score += 1;
    if (PROMPT_WORDS.some((w) => label.includes(w))) score += 3;
    // Composers live at the bottom of the page. Cheap tiebreaker, not a rule:
    // a composer that has scrolled is still a composer.
    if (d.viewportHeight && d.top > d.viewportHeight * 0.45) score += 1;
    // Prefer the roomier box when two candidates are otherwise tied (ChatGPT
    // renders a hidden 1-line mirror alongside the real editor).
    if ((d.height || 0) >= 30) score += 1;

    return score;
  }

  /**
   * Highest-scoring descriptor at or above the confidence floor. Ties break on
   * area, so the visible editor beats a same-score off-screen twin.
   * Returns null when nothing qualifies.
   */
  function pickBest(descriptors) {
    let best = null;
    let bestScore = 0;
    for (const d of descriptors || []) {
      const score = scoreCandidate(d);
      if (score < MIN_SCORE) continue;
      const area = (d.width || 0) * (d.height || 0);
      const bestArea = best ? (best.width || 0) * (best.height || 0) : -1;
      if (score > bestScore || (score === bestScore && area > bestArea)) {
        best = d;
        bestScore = score;
      }
    }
    return best ? { descriptor: best, score: bestScore } : null;
  }

  // ── DOM layer ─────────────────────────────────────────────────────────────

  function labelFor(el) {
    const parts = [
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('data-placeholder'),
      el.getAttribute?.('name'),
      el.getAttribute?.('id'),
    ];
    // ChatGPT and Claude render the placeholder as a sibling/child node rather
    // than an attribute, so pull the nearest one in.
    const ph = el.parentElement?.querySelector?.('[data-placeholder], .placeholder, [class*="placeholder"]');
    if (ph && ph !== el) parts.push(ph.getAttribute?.('data-placeholder') || ph.textContent);
    return parts.filter(Boolean).join(' ').slice(0, 300);
  }

  function hasEditorHint(el) {
    return !!(
      el.id === 'prompt-textarea' ||
      el.hasAttribute?.('data-lexical-editor') ||
      el.classList?.contains('ProseMirror') ||
      el.hasAttribute?.('data-virtualkeyboard') ||
      el.getAttribute?.('data-testid') === 'chat-input' ||
      el.closest?.('[data-testid="composer"], form[data-type="unified-composer"], #composer-background')
    );
  }

  // Walk up a bounded number of ancestors looking for a send/stop control. The
  // bound matters: an unbounded search would find the page's global submit
  // button and mark every text box on the page as a composer.
  function hasNearbySend(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1) {
      if (node.querySelector?.(SEND_SELECTOR)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function isVisible(el, rect) {
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;
    const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    if (!style) return true; // no style engine (tests) — trust the geometry
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  /** Build a scoring descriptor for one element. */
  function describe(el, opts) {
    const options = opts || {};
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0, top: 0 };
    const view = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    let matchesAdapter = false;
    if (options.adapterSelector) {
      try {
        matchesAdapter = !!(el.matches?.(options.adapterSelector) || el.closest?.(options.adapterSelector));
      } catch (_) { matchesAdapter = false; }
    }
    return {
      el,
      tag: el.tagName || '',
      isContentEditable: el.isContentEditable === true ||
        ['', 'true', 'plaintext-only'].includes(el.getAttribute?.('contenteditable')),
      role: el.getAttribute?.('role') || '',
      disabled: el.disabled === true || el.getAttribute?.('aria-disabled') === 'true',
      readOnly: el.readOnly === true,
      visible: isVisible(el, rect),
      width: rect.width,
      height: rect.height,
      top: rect.top,
      viewportHeight: view ? view.innerHeight : 0,
      label: labelFor(el),
      matchesAdapter,
      hasNearbySend: hasNearbySend(el),
      inForm: !!el.closest?.('form'),
      editorHint: hasEditorHint(el),
      insideOwnUi: !!el.closest?.('#pf-assistant-root, #pf-floating-overlay, #pf-modal-overlay'),
    };
  }

  /**
   * The current composer element, or null.
   *
   * `opts.adapterSelector` (the platform adapter's `inputSelector`) is used as
   * one signal among several — never as a requirement — so a ChatGPT redesign
   * that invalidates the selector degrades detection instead of breaking it.
   */
  function findComposer(doc, opts) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.querySelectorAll) return null;
    let nodes;
    try {
      nodes = d.querySelectorAll(CANDIDATE_SELECTOR);
    } catch (_) {
      return null;
    }
    const descriptors = [];
    for (const el of nodes) {
      // Nested editables (a <p> inside ProseMirror) — always prefer the root.
      const inner = el.parentElement?.closest?.('[contenteditable="true"], [contenteditable=""]');
      if (inner && inner !== el) continue;
      descriptors.push(describe(el, opts));
    }
    const best = pickBest(descriptors);
    return best ? best.descriptor.el : null;
  }

  /**
   * The element to anchor UI to: the composer's visible box, not the raw
   * editable node.
   *
   * ChatGPT's editable div sits INSIDE the rounded composer surface, alongside
   * the attachment row, the model picker, the dictation button, and send. Using
   * the editable's own rect would place anything "above" it on top of that
   * chrome. Climbing to the enclosing surface — and stopping before the page
   * container — is what keeps the assistant outside everything the user needs
   * to click.
   */
  function composerBox(el) {
    if (!el || !el.getBoundingClientRect) return el;
    const inner = el.getBoundingClientRect();
    const view = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const vw = view ? view.innerWidth : 0;
    const vh = view ? view.innerHeight : 0;
    let best = el;
    let node = el.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1) {
      const r = node.getBoundingClientRect();
      // Stop at the first ancestor that is a page region rather than the
      // composer surface: much wider, much taller, or most of the viewport.
      const tooWide = r.width > inner.width + 160;
      const tooTall = r.height > inner.height + 220;
      const tooBig = vw && vh && (r.width * r.height) > vw * vh * 0.5;
      if (tooWide || tooTall || tooBig) break;
      best = node;
      node = node.parentElement;
    }
    return best;
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
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 3) {                        // text
          out.push(child.nodeValue || '');
        } else if (child.nodeType === 1) {                 // element
          if (child.tagName === 'BR') { out.push('\n'); continue; }
          const block = BLOCK_TAGS.has(child.tagName);
          if (block && out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
          walk(child);
          if (block) out.push('\n');
        }
      }
    };
    walk(el);
    // A trailing newline is an artifact of the final block, not user content.
    return out.join('').replace(/\n+$/, '');
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  // React tracks the value it last rendered on the DOM node itself. Assigning
  // `el.value = x` updates the node but leaves that tracker in step, so React's
  // onChange never fires and its state silently diverges from what the user
  // sees. Going through the prototype's native setter defeats the tracker,
  // which is the documented way to drive a controlled input from outside React.
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? (typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement.prototype : null)
      : (typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : null);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  /**
   * Select an editable's entire contents and return the Range.
   *
   * The range is anchored on the first and last TEXT NODES rather than on the
   * editable root. A range whose container is the root is ambiguous — it points
   * at a child index, not a text position — and rich editors that map DOM
   * selections onto their own model handle it inconsistently. Anchoring on text
   * nodes produces exactly the selection a user's Ctrl+A does.
   */
  function selectAllContents(el) {
    const doc = el.ownerDocument || document;
    const view = doc.defaultView || window;
    const selection = view.getSelection();
    if (!selection) return null;
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
    if (first && last) {
      range.setStart(first, 0);
      range.setEnd(last, (last.nodeValue || '').length);
    } else {
      range.selectNodeContents(el);          // genuinely empty editor
    }
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
  }

  /**
   * Put the caret at the end of the editable's text.
   *
   * Anchored on the last text node for the same reason `selectAllContents` is:
   * a position expressed against the root element is a child index, and editors
   * that own their selection model resolve it inconsistently — which is how a
   * caret ends up somewhere other than where the user just watched text appear.
   */
  function collapseToEnd(el) {
    const doc = el.ownerDocument || document;
    const view = doc.defaultView || window;
    const selection = view.getSelection();
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
  }

  /**
   * Leave a usable caret behind after a write.
   *
   * An editor that applied the change itself has already placed its caret, and
   * it knows better than we do — so we only step in when the selection is still
   * spanning content, which would mean the user's next keystroke wipes the text
   * we just inserted.
   */
  function ensureCaret(el) {
    const view = (el.ownerDocument || document).defaultView || window;
    const selection = view.getSelection && view.getSelection();
    if (selection && selection.isCollapsed) return;
    collapseToEnd(el);
  }

  /**
   * Replace the composer's contents with `text` in a way the host editor
   * actually notices. Returns true on success, false without having damaged
   * anything.
   *
   * THE IMPORTANT PART. ChatGPT (Lexical) and Claude (ProseMirror) do not treat
   * the DOM as the source of truth: they keep their own document model, and the
   * message that gets sent comes from that model, not from the markup. So a
   * write is only real if the editor itself performs it.
   *
   * `execCommand('insertText')` cannot be trusted to do that. In Chromium it
   * edits the DOM and fires `input`, but it does NOT fire a cancelable
   * `beforeinput` — which is the event those editors build their model from. The
   * result is the exact failure this is written to prevent: the box shows the
   * new prompt, the model still holds the old one, and pressing send transmits
   * the old text. Worse, `execCommand` returns `true` in that case, so its
   * return value proves nothing.
   *
   * Instead we offer the edit to the editor and let it tell us whether it took
   * it. `dispatchEvent` returns false when a listener called `preventDefault()`,
   * which for these editors means "I own this change and I have applied it to my
   * model". Only if nothing claims the edit do we fall back to the native path,
   * and only then is reading the DOM back a meaningful check.
   *
   * Direct DOM writing (`textContent`/`innerHTML`) is deliberately NOT a
   * fallback. It is the one approach guaranteed to desynchronize the editor.
   * Failing honestly lets the UI offer "copy instead".
   */
  function writeText(el, text) {
    if (!el) return false;
    const value = typeof text === 'string' ? text : '';

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setNativeValue(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // Caret to the end of the new text: the whole field was replaced, so an
      // old offset no longer refers to anything, and end-of-text is where the
      // user continues typing or presses send.
      try { el.setSelectionRange(value.length, value.length); } catch (_) { /* not selectable */ }
      return true;
    }

    const doc = el.ownerDocument || document;
    const matches = () => readText(el).trim() === value.trim();

    let selected = false;
    try {
      el.focus();
      selected = !!selectAllContents(el);
    } catch (_) {
      return false;
    }
    if (!selected) return false;

    // 1. Offer it as a replacement of the current selection. This is the most
    //    precise statement of intent — "these characters become that text" —
    //    and it carries no clipboard semantics, so editors that transform
    //    pasted content (markdown, smart quotes) leave ours alone.
    const dataTransfer = () => {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', value);
        return dt;
      } catch (_) { return null; }
    };

    for (const inputType of ['insertText', 'insertReplacementText']) {
      try {
        const claimed = !el.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType,
          data: value,
          dataTransfer: dataTransfer(),
        }));
        // Claimed means the editor is applying it to its own model; it may do so
        // in a microtask, so a DOM read here can legitimately lag.
        if (claimed) { ensureCaret(el); return true; }
        if (matches()) { ensureCaret(el); return true; }
      } catch (_) { /* try the next mechanism */ }
    }

    // 2. Offer it as a paste. ProseMirror-family editors handle `paste`
    //    explicitly even where they ignore synthetic beforeinput.
    try {
      const dt = dataTransfer();
      if (dt) {
        const claimed = !el.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, composed: true, clipboardData: dt,
        }));
        if (claimed) { ensureCaret(el); return true; }
        if (matches()) { ensureCaret(el); return true; }
      }
    } catch (_) { /* try the native path */ }

    // 3. Nothing claimed it, so this is a plain contenteditable with no model of
    //    its own. Here the native command IS the right tool, and reading the DOM
    //    back genuinely verifies the result.
    try {
      selectAllContents(el);
      if (value) doc.execCommand('insertText', false, value);
      else doc.execCommand('delete', false);
      // This edit was ours, not an editor's, so we own the caret outright rather
      // than deferring to whatever the command happened to leave behind.
      if (matches()) { collapseToEnd(el); return true; }
    } catch (_) { /* fall through to the honest failure */ }

    return false;
  }

  const PFComposer = {
    CANDIDATE_SELECTOR,
    SEND_SELECTOR,
    MIN_SCORE,
    scoreCandidate,
    pickBest,
    describe,
    findComposer,
    composerBox,
    readText,
    writeText,
    selectAllContents,
    collapseToEnd,
    ensureCaret,
    setNativeValue,
  };

  if (root) root.PFComposer = PFComposer;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFComposer;
})(typeof self !== 'undefined' ? self : this);
