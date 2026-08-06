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

  // execCommand as Chrome implements it for our two commands, plus a log so a
  // test can prove the primary write path ran rather than a fallback.
  const commands = [];
  window.document.execCommand = (command, _ui, value) => {
    commands.push({ command, value });
    const target = window.document.activeElement;
    if (!target) return false;
    if (command === 'insertText') { target.textContent = value; return true; }
    if (command === 'delete') { target.textContent = ''; return true; }
    return false;
  };
  // jsdom's getSelection is present but does not drive execCommand; the stub
  // above works off activeElement, so selection calls only need to not throw.
  window.getSelection = window.getSelection || (() => ({
    removeAllRanges() {}, addRange() {}, selectAllChildren() {},
  }));

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
 * Turn a contenteditable into a stand-in for Lexical / ProseMirror: an editor
 * that keeps its OWN document model and treats the DOM as a rendering of it.
 *
 * This is the shape that matters. Those editors send what is in their model, not
 * what is in the markup, and they build that model from `beforeinput` and
 * `paste` — both of which they cancel. Anything that edits the DOM without going
 * through one of them (including `execCommand`, which fires `input` but no
 * `beforeinput`, and any `textContent`/`innerHTML` write) leaves the model
 * holding the old prompt while the box shows the new one.
 *
 * Returns a handle whose `state` is the model — assert against that, never the
 * DOM, or the test cannot see the bug.
 */
function attachModelEditor(el) {
  let model = readModelFromDom();
  let caretAtEnd = true;

  function readModelFromDom() {
    const paras = el.querySelectorAll('p');
    if (paras.length) return Array.from(paras).map((p) => p.textContent || '');
    return [el.textContent || ''];
  }
  function render() {
    el.innerHTML = model.map((line) => `<p>${line.replace(/[&<>]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>`).join('');
  }
  /** Replace the whole model — the editors collapse a full-content selection. */
  function apply(text) {
    model = String(text).split('\n');
    if (!model.length) model = [''];
    caretAtEnd = true;
    render();
    el.dispatchEvent(new el.ownerDocument.defaultView.InputEvent('input', {
      bubbles: true, inputType: 'insertText',
    }));
  }

  const onBeforeInput = (e) => {
    const type = e.inputType || '';
    if (!/^insert(Text|ReplacementText|FromPaste)$/.test(type)) return;
    e.preventDefault();                       // "I own this change"
    apply(e.data != null ? e.data : '');
  };
  const onPaste = (e) => {
    e.preventDefault();
    const dt = e.clipboardData;
    apply(dt && dt.getData ? dt.getData('text/plain') : '');
  };
  el.addEventListener('beforeinput', onBeforeInput);
  el.addEventListener('paste', onPaste);

  render();
  return {
    /** What the app would actually send. */
    get state() { return model.join('\n'); },
    set state(next) { model = String(next).split('\n'); render(); },
    /** True while nobody has written behind the editor's back. */
    get inSync() {
      return Array.from(el.querySelectorAll('p')).map((p) => p.textContent || '').join('\n')
        === model.join('\n');
    },
    get caretAtEnd() { return caretAtEnd; },
    detach() {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('paste', onPaste);
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
  TEXTAREA_HTML,
};
