// Test helper: a throwaway ChatGPT-shaped page for the DOM-level tests.
// ---------------------------------------------------------------------------
// The composer layer and the in-page assistant are DOM code, so testing them
// honestly needs a DOM. jsdom is a devDependency, NOT a runtime one — `npm test`
// still runs with nothing installed, and the DOM-backed cases skip themselves
// (see `available`) instead of failing. Run `npm install` in extension/ to
// exercise them.
//
// jsdom is missing three things this code legitimately uses in a browser, so we
// provide them here rather than weakening the code to suit the test:
//   • ResizeObserver   — used for re-anchoring; a no-op stub is faithful enough
//   • execCommand      — the contenteditable write path; stubbed to behave the
//                        way Chrome does, and recorded so tests can assert it
//                        was the path taken
//   • layout           — jsdom reports every rect as 0×0, so sizes are declared
//                        per element with `size()`

let jsdom = null;
try {
  // eslint-disable-next-line global-require
  jsdom = require('jsdom');
} catch (_) {
  jsdom = null;
}

const available = !!jsdom;

// `performance` is deliberately NOT in this list: jsdom's implementation
// delegates to the global one, so installing it over Node's makes it call
// itself. Node's own `performance` works fine for the animation timing that
// uses it.
const GLOBAL_KEYS = [
  'window', 'document', 'navigator', 'location', 'HTMLElement', 'HTMLTextAreaElement',
  'HTMLInputElement', 'Event', 'InputEvent', 'MutationObserver', 'ResizeObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'Node',
  'DataTransfer', 'ClipboardEvent', 'CustomEvent',
];

/**
 * Give an element a real size. `scoreCandidate` disqualifies anything too small
 * to be a prompt box, which under jsdom's 0×0 layout would be everything.
 */
function size(el, rect) {
  const box = {
    width: 600, height: 60, top: 500, left: 100, bottom: 560, right: 700,
    x: 100, y: 500, ...rect,
  };
  el.getBoundingClientRect = () => box;
  return el;
}

/**
 * Build a page and install its globals. Always pair with `page.restore()`.
 *
 * `chrome` is stubbed with just enough of the extension API for the assistant:
 * a resource URL resolver and an in-memory `storage.local`.
 */
function createPage(html, options) {
  if (!jsdom) throw new Error('jsdom is not installed');
  const opts = options || {};
  const dom = new jsdom.JSDOM(html || '<!doctype html><html><body></body></html>', {
    url: opts.url || 'https://chatgpt.com/',
    pretendToBeVisual: true,
  });
  const window = dom.window;

  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = window.matchMedia || (() => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  }));

  // execCommand, as Chromium actually implements it — MEASURED, not assumed.
  //
  // A previous version of this stub dispatched a cancelable `beforeinput` with
  // target ranges, on the theory that `execCommand` runs the real editing
  // pipeline. The browser e2e run disproved it: in Chromium 139, calling
  // `document.execCommand('insertText', …)` from script fires NO `beforeinput`
  // at all — from the page's own world or from a content script — while editing
  // the DOM and returning `true`.
  //
  // That is the entire reason `execCommand` is kept away from Lexical and
  // ProseMirror: it would leave the box showing the new prompt and the editor's
  // model holding the old one. Modelling it accurately here is what lets the
  // fast node:test suite catch that, instead of only the browser run.
  //
  // `commands` records what ran, so a test can prove which path was taken.
  const commands = [];
  window.document.execCommand = (command, _ui, value) => {
    commands.push({ command, value });
    if (window.__pfNoExecCommand) return false;
    const target = window.document.activeElement;
    // jsdom does not implement the `isContentEditable` IDL attribute, so the
    // markup attribute stands in for it. In a browser both are present and
    // agree; here only the attribute is.
    const editable = target && (target.isContentEditable === true ||
      ['', 'true', 'plaintext-only'].includes(target.getAttribute('contenteditable')));
    if (!editable) return false;
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (range) {
      try {
        range.deleteContents();
        if (command === 'insertText' && value) {
          range.insertNode(window.document.createTextNode(value));
        }
        // `input` only. This is the whole point of the stub.
        target.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
        return true;
      } catch (_) { /* fall through to the coarse form */ }
    }
    if (command === 'insertText') { target.textContent = value; return true; }
    if (command === 'delete') { target.textContent = ''; return true; }
    return false;
  };

  const store = {};
  const chromeStub = {
    runtime: {
      id: 'test-extension-id',
      getURL: (p) => `chrome-extension://test/${p}`,
      lastError: null,
      sendMessage: (_msg, cb) => { if (cb) cb({}); },
      onMessage: { addListener() {} },
    },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          const list = keys == null ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys]);
          list.forEach((k) => { if (k in store) out[k] = store[k]; });
          cb(out);
        },
        set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
        remove(keys, cb) {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete store[k]; });
          if (cb) cb();
        },
      },
    },
  };

  const saved = {};
  for (const key of GLOBAL_KEYS) {
    saved[key] = global[key];
    if (key === 'window') global.window = window;
    else if (key === 'ResizeObserver') global.ResizeObserver = window.ResizeObserver;
    else if (window[key] !== undefined) global[key] = window[key];
  }
  saved.chrome = global.chrome;
  global.chrome = chromeStub;

  return {
    dom,
    window,
    document: window.document,
    chrome: chromeStub,
    storage: store,
    commands,
    size,
    /** Let queued microtasks/timers run — analysis and rendering are async. */
    tick(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms || 0));
    },
    restore() {
      for (const key of GLOBAL_KEYS) {
        if (saved[key] === undefined) delete global[key];
        else global[key] = saved[key];
      }
      if (saved.chrome === undefined) delete global.chrome;
      else global.chrome = saved.chrome;
      window.close();
    },
  };
}

/**
 * Turn a contenteditable into a stand-in for Lexical / ProseMirror.
 *
 * THIS DOUBLE IS THE TEST. The previous version modelled only half of what those
 * editors do — it kept its own document model, but applied every edit to the
 * WHOLE model regardless of where the selection was. That made the append bug
 * invisible: any write "worked", because the double could not put text in the
 * wrong place even if asked to.
 *
 * A faithful double has to model three things:
 *
 *   1. ITS OWN DOCUMENT MODEL. The DOM is a rendering of it; `state` is what
 *      would actually be sent.
 *   2. ITS OWN COPY OF THE SELECTION, refreshed only when it observes a
 *      `selectionchange` event. This is the part that matters. Setting
 *      `window.getSelection()` does not tell the editor anything; the browser
 *      notifies it separately, asynchronously, and until then the editor still
 *      believes the caret is where it last saw it.
 *   3. A PREFERENCE FOR TARGET RANGES. Given a trusted `beforeinput` (which is
 *      what `execCommand` produces in Chromium), it edits `getTargetRanges()[0]`
 *      — computed by the browser from the real selection. Given a synthetic one,
 *      which carries no ranges, it falls back to its cached selection.
 *
 * With those three, writing at a stale caret produces `old + new`, exactly as
 * ChatGPT and Claude do, and a test can see it.
 */
function attachModelEditor(el, opts) {
  // Two knobs, both modelling a real hazard rather than a hypothetical one:
  //   ignoreSelectionChange — an editor that caches the selection and does not
  //     subscribe to `selectionchange` (or subscribes on a node we do not reach)
  //   ignoreTargetRanges    — an editor that works purely from its cached
  //     selection even on a trusted event
  // Together they describe the worst case, where no strategy can place the edit
  // correctly. The guarantee that must still hold there is that the user's
  // prompt is never left duplicated.
  const behaviour = opts || {};
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  let model = readModelFromDom();
  // The editor's cached selection, as flat offsets into `text()`. Starts
  // collapsed at the end, which is where a composer's caret sits after typing.
  let cached = null;

  function readModelFromDom() {
    const paras = el.querySelectorAll('p');
    if (paras.length) return Array.from(paras).map((p) => p.textContent || '');
    return [el.textContent || ''];
  }
  function text() { return model.join('\n'); }
  function end() { return { start: text().length, end: text().length }; }

  function render() {
    el.innerHTML = model.map((line) => `<p>${line.replace(/[&<>]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}${line ? '' : '<br>'}</p>`).join('');
  }

  /** Flat offset where paragraph `i` starts (paragraph breaks are one \n). */
  function paraStart(i) {
    let n = 0;
    for (let k = 0; k < i && k < model.length; k += 1) n += model[k].length + 1;
    return n;
  }

  /** Map a DOM (node, offset) position onto a flat offset in `text()`. */
  function flatten(node, offset) {
    if (!node || !el.contains(node)) return null;
    if (node === el) return paraStart(Math.min(offset, model.length));
    let p = node;
    while (p && p.parentElement !== el) p = p.parentElement;
    if (!p) return null;
    const i = Array.prototype.indexOf.call(el.children, p);
    if (i < 0) return null;
    if (node === p) return paraStart(i) + (offset === 0 ? 0 : (model[i] || '').length);
    return paraStart(i) + Math.min(offset, (model[i] || '').length);
  }

  function rangeToOffsets(range) {
    if (!range) return null;
    const start = flatten(range.startContainer, range.startOffset);
    const stop = flatten(range.endContainer, range.endOffset);
    if (start == null || stop == null) return null;
    return { start: Math.min(start, stop), end: Math.max(start, stop) };
  }

  /** What a real editor does when the browser tells it the selection moved. */
  function onSelectionChange() {
    const sel = view.getSelection && view.getSelection();
    if (!sel || !sel.rangeCount) return;
    const next = rangeToOffsets(sel.getRangeAt(0));
    if (next) cached = next;
  }
  if (!behaviour.ignoreSelectionChange) doc.addEventListener('selectionchange', onSelectionChange);

  /** Reconcile the DOM selection to the model's caret, as a real editor does. */
  function placeCaret(at) {
    let i = 0;
    let remaining = at;
    while (i < model.length && remaining > model[i].length) { remaining -= model[i].length + 1; i += 1; }
    const p = el.children[Math.min(i, el.children.length - 1)];
    if (!p) return;
    const node = p.firstChild && p.firstChild.nodeType === 3 ? p.firstChild : p;
    try {
      const range = doc.createRange();
      range.setStart(node, node.nodeType === 3 ? Math.min(remaining, node.nodeValue.length) : 0);
      range.collapse(true);
      const sel = view.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) { /* selection reconciliation is best effort */ }
  }

  // A real editor keeps an undo stack, and `historyUndo` is the one repair that
  // does not depend on the selection — which is exactly why the extension
  // reaches for it when a selection-driven strategy has just misfired.
  const history = [];

  function applyAt(target, insert) {
    const t = text();
    history.push(model.slice());
    const from = Math.max(0, Math.min(target.start, t.length));
    const to = Math.max(from, Math.min(target.end, t.length));
    const next = t.slice(0, from) + insert + t.slice(to);
    model = next.split('\n');
    if (!model.length) model = [''];
    render();
    const caret = from + insert.length;
    cached = { start: caret, end: caret };
    placeCaret(caret);
    el.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  }

  /**
   * Where this edit applies. Target ranges first — the browser computed them
   * from the real selection for a trusted event — then the cached selection,
   * which is all a synthetic event leaves the editor to work with.
   */
  function targetOf(e) {
    let ranges = [];
    if (behaviour.ignoreTargetRanges) return cached || end();
    try { ranges = (typeof e.getTargetRanges === 'function' && e.getTargetRanges()) || []; } catch (_) { ranges = []; }
    if (ranges.length) {
      const mapped = rangeToOffsets(ranges[0]);
      if (mapped) return mapped;
    }
    return cached || end();
  }

  const onBeforeInput = (e) => {
    const type = e.inputType || '';
    const target = targetOf(e);
    if (/^insert(Text|ReplacementText|FromPaste)$/.test(type)) {
      e.preventDefault();                       // "I own this change"
      const data = e.data != null ? e.data
        : (e.dataTransfer && e.dataTransfer.getData ? e.dataTransfer.getData('text/plain') : '');
      applyAt(target, data || '');
      return;
    }
    if (/^delete/.test(type)) {
      e.preventDefault();
      const t = { ...target };
      if (t.start === t.end && t.start > 0) t.start -= 1;   // a bare backspace
      applyAt(t, '');
      return;
    }
    if (type === 'historyUndo') {
      e.preventDefault();
      if (!history.length) return;
      model = history.pop();
      render();
      cached = end();
      placeCaret(text().length);
      el.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'historyUndo' }));
    }
  };
  const onPaste = (e) => {
    e.preventDefault();
    const dt = e.clipboardData;
    applyAt(targetOf(e), dt && dt.getData ? dt.getData('text/plain') : '');
  };
  el.addEventListener('beforeinput', onBeforeInput);
  el.addEventListener('paste', onPaste);

  render();
  return {
    /** What the app would actually send. */
    get state() { return text(); },
    set state(next) {
      model = String(next).split('\n');
      if (!model.length) model = [''];
      history.length = 0;                     // a fresh draft, not an edit
      render();
      cached = end();
      placeCaret(text().length);
    },
    /** True while nobody has written behind the editor's back. */
    get inSync() {
      return Array.from(el.querySelectorAll('p')).map((p) => p.textContent || '').join('\n')
        === text();
    },
    /** The selection the EDITOR believes is current, not the DOM's. */
    get cachedSelection() { return cached ? { ...cached } : null; },
    get caretAtEnd() { return !!cached && cached.start === text().length && cached.end === cached.start; },
    detach() {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('paste', onPaste);
      doc.removeEventListener('selectionchange', onSelectionChange);
    },
  };
}

/** A page shaped like ChatGPT's Lexical composer, plus decoy text boxes. */
const CHATGPT_HTML = `<!doctype html><html class="dark"><body>
  <header>
    <input type="text" aria-label="Search chats" id="decoy-search">
    <div contenteditable="true" id="decoy-rename" aria-label="Rename conversation"></div>
  </header>
  <main><div id="thread"></div></main>
  <form data-type="unified-composer">
    <div id="composer-background">
      <div contenteditable="true" id="prompt-textarea" data-lexical-editor="true"
           data-placeholder="Ask anything" role="textbox"><p><br></p></div>
      <div class="composer-actions">
        <button aria-label="Attach files"></button>
        <button data-testid="send-button" aria-label="Send prompt"></button>
      </div>
    </div>
  </form>
</body></html>`;

/** A page shaped like Claude's ProseMirror composer. */
const CLAUDE_HTML = `<!doctype html><html><body>
  <main><div class="chat"></div></main>
  <fieldset>
    <div contenteditable="true" class="ProseMirror" aria-label="Write your prompt to Claude"><p></p></div>
    <button aria-label="Send message"></button>
  </fieldset>
</body></html>`;

/**
 * A page whose composer is a PLAIN contenteditable — no Lexical, no ProseMirror,
 * nothing that owns a document model. The one shape where `execCommand` is the
 * right tool, and the reason the strategy list still contains it.
 */
const PLAIN_HTML = `<!doctype html><html><body>
  <main><div id="thread"></div></main>
  <form>
    <div id="prompt-box" contenteditable="true" role="textbox"
         data-placeholder="Send a message"></div>
    <button data-testid="send-button" aria-label="Send prompt"></button>
  </form>
</body></html>`;

/** A legacy page where the composer is a plain textarea. */
const TEXTAREA_HTML = `<!doctype html><html><body>
  <form>
    <textarea id="prompt-textarea" placeholder="Send a message"></textarea>
    <button type="submit" data-testid="send-button"></button>
  </form>
</body></html>`;

module.exports = {
  available,
  createPage,
  attachModelEditor,
  size,
  CHATGPT_HTML,
  CLAUDE_HTML,
  PLAIN_HTML,
  TEXTAREA_HTML,
};
