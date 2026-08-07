// PromptFootprint — OpenAI / ChatGPT model adapter
// ---------------------------------------------------------------------------
// ChatGPT's picker is SELECTED INTENT, not guaranteed backend identity. Auto may
// route, workspaces expose different model sets, custom GPTs carry their own
// configuration, and existing chats migrate to newer models over time. So this
// adapter reports what the product shows and marks everything it cannot prove.
//
// Selectors are lists, not single strings: the first entries are the current
// test ids, the later ones are role/ARIA fallbacks that survive a class-name
// reshuffle. If every one of them misses, detection returns "unknown" and the
// page keeps working — the extension never blocks the app. [S15][S16]

(function (root) {
  'use strict';

  const SH = (typeof PFAdapterShared !== 'undefined') ? PFAdapterShared : require('./shared.js');

  const PICKER_SELECTORS = [
    '[data-testid="model-switcher-dropdown-button"]',
    '[data-testid="model-switcher"]',
    '#model-switcher-button',
    'button[aria-label*="model" i]',
    'button[aria-haspopup="menu"][id*="model" i]',
    'button[data-testid*="model" i]',
  ];

  const MENU_SELECTORS = [
    '[role="menu"] [role="menuitemradio"]',
    '[role="menu"] [role="menuitem"]',
    '[role="listbox"] [role="option"]',
    '[data-radix-menu-content] [role="menuitemradio"]',
  ];

  const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    'form[data-type="unified-composer"] [contenteditable="true"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'textarea[data-id]',
  ];

  const REGION_SELECTORS = [
    '#page-header', 'header', 'form[data-type="unified-composer"]', '#composer-background', 'main',
  ];

  const TOOL_SELECTORS = [
    'form[data-type="unified-composer"] button',
    '[data-testid*="composer-button"]',
    '[data-testid*="system-hint"]',
    'button[aria-pressed]',
    '[role="button"][aria-pressed]',
  ];

  // Visible chip wording -> canonical tool id used by the estimator.
  const TOOL_VOCABULARY = {
    'deep research': 'deep-research',
    'search the web': 'web-search',
    search: 'web-search',
    browse: 'browsing',
    canvas: 'canvas',
    'create image': 'image',
    image: 'image',
    'code interpreter': 'code-execution',
    'data analysis': 'code-execution',
    python: 'code-execution',
    'computer use': 'computer-use',
    agent: 'agent',
    codex: 'codex',
    study: 'study',
  };

  const adapter = {
    id: 'openai',
    provider: 'openai',
    defaultSurface: 'chatgpt',
    hosts: ['chatgpt.com', 'chat.openai.com'],

    matchesLocation(url) {
      const host = url && url.host ? url.host : String(url || '');
      return this.hosts.some((h) => host.includes(h));
    },

    findComposer(scope) {
      return SH.firstMatch(scope || document, COMPOSER_SELECTORS);
    },

    findModelControls(scope) {
      const doc = scope || document;
      return SH.queryAll(doc, PICKER_SELECTORS).concat(SH.queryAll(doc, MENU_SELECTORS));
    },

    /** The smallest stable ancestors worth watching for model/mode changes. */
    observeRoots(scope) {
      const doc = scope || document;
      const roots = SH.queryAll(doc, REGION_SELECTORS.concat(['[role="menu"]', '[data-radix-popper-content-wrapper]']));
      return roots.length ? roots : [doc.body].filter(Boolean);
    },

    /** Custom GPTs live under /g/; their NAME says nothing about the backend. */
    readSurface(scope, url) {
      const path = (url && url.pathname) || (typeof location !== 'undefined' ? location.pathname : '');
      if (/\/g\//.test(path)) return 'custom-gpt';
      return 'chatgpt';
    },

    readConversationKey(url) {
      const path = (url && url.pathname) || (typeof location !== 'undefined' ? location.pathname : '');
      const id = SH.pathSegmentAfter(path, 'c') || SH.pathSegmentAfter(path, 'g');
      return id ? `openai:${id}` : null;
    },

    /** Watch this adapter's roots; returns the teardown. */
    observe(onChange, opts) {
      return SH.observeAdapter(this, onChange, opts);
    },

    readToolModes(scope) {
      return SH.readToolChips(scope || document, TOOL_SELECTORS, TOOL_VOCABULARY);
    },

    collectCandidates(scope) {
      const doc = scope || document;
      const anchors = SH.queryAll(doc, REGION_SELECTORS);
      const out = [];

      // 1. The selected option in an OPEN menu is the strongest signal there is:
      //    it is the product telling us, in the accessibility tree, which row is
      //    current. Unselected rows are collected too so a hidden menu clone full
      //    of model names cannot outscore the real control.
      SH.queryAll(doc, MENU_SELECTORS).forEach((el) => {
        const cand = SH.candidateFrom(el, 'openai', {
          optionRow: true,
          nearComposer: SH.isNear(el, anchors),
        });
        cand.source = cand.selected ? 'selected-menu-item' : 'aria';
        out.push(cand);
      });

      // 2. The picker button itself, which is all we have while the menu is shut.
      SH.queryAll(doc, PICKER_SELECTORS).forEach((el) => {
        out.push(SH.candidateFrom(el, 'openai', {
          source: 'picker-label',
          nearComposer: true,
        }));
      });

      return out;
    },

    refine(obs) {
      const next = { ...obs };
      // A custom GPT's title is a user-chosen name. It is not a model, and the
      // backend it runs on is provider-managed and may migrate. [S15]
      if (next.surface === 'custom-gpt' && next.routing === 'unknown') {
        next.routing = 'unknown';
      }
      return next;
    },

    readModelObservation(scope, opts) {
      const doc = scope || document;
      const o = opts || {};
      const url = o.url || (typeof location !== 'undefined' ? location : null);
      return SH.buildObservation(this, {
        candidates: this.collectCandidates(doc),
        surface: this.readSurface(doc, url),
        tools: this.readToolModes(doc),
        conversationKey: this.readConversationKey(url),
        effectiveModel: o.effectiveModel || null,
        now: o.now,
      });
    },
  };

  const PFAdapterOpenAI = adapter;
  if (root) root.PFAdapterOpenAI = PFAdapterOpenAI;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFAdapterOpenAI;
})(typeof self !== 'undefined' ? self : this);
