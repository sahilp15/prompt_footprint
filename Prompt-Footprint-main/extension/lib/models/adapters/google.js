// PromptFootprint — Google / Gemini model adapter
// ---------------------------------------------------------------------------
// Google's own help documents the switch point: the model name appears inside or
// underneath the text box, and that control is where users change models. That
// makes the composer-adjacent mode button the primary detection target rather
// than anything in the page chrome. [S20]
//
// Two Gemini-specific traps this adapter is built to avoid:
//   • Gemini 3.6 Flash is the EFFICIENT tier even though 3.6 > 3.1. A higher
//     version number is not evidence of heavier compute, so Flash and Pro must
//     stay distinct rather than being ordered by their numbers. [S19]
//   • A Gem is a configuration, not a model identity. Its name is user-written,
//     so the surface is recorded as `gem` and the base model is read separately
//     when the UI exposes it.

(function (root) {
  'use strict';

  const SH = (typeof PFAdapterShared !== 'undefined') ? PFAdapterShared : require('./shared.js');

  const PICKER_SELECTORS = [
    '[data-test-id="bard-mode-menu-button"]',
    '[data-test-id="mode-switch-button"]',
    'button.gds-mode-switch-button',
    '.mode-switcher button',
    'button[aria-label*="model" i]',
    'button[aria-haspopup="menu"][aria-label*="mode" i]',
  ];

  const MENU_SELECTORS = [
    '[role="menu"] [role="menuitemradio"]',
    '[role="menu"] [role="menuitem"]',
    '[role="listbox"] [role="option"]',
    '.mat-mdc-menu-panel .mat-mdc-menu-item',
  ];

  const COMPOSER_SELECTORS = [
    'rich-textarea .ql-editor',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea[aria-label*="prompt" i]',
  ];

  const REGION_SELECTORS = ['input-container', 'rich-textarea', 'main', 'header', '.input-area'];

  /**
   * Gemini expresses reasoning as a MODE chip next to the composer rather than
   * as an effort scale. Deep Think is the awkward one: it is both a named model
   * in the picker and a reasoning mode, so it is read in both places and
   * reconciled in `refine`.
   */
  const REASONING_SELECTORS = [
    '[data-test-id*="thinking" i]',
    '[data-test-id*="reasoning" i]',
    'button[aria-label*="thinking" i]',
    'button[aria-label*="reasoning" i]',
    'button[aria-label*="deep think" i]',
  ];

  const TOOL_SELECTORS = [
    'toolbox-drawer button',
    'button[aria-pressed]',
    '[role="button"][aria-pressed]',
    '[data-test-id*="button"]',
  ];

  const TOOL_VOCABULARY = {
    'deep research': 'deep-research',
    research: 'deep-research',
    canvas: 'canvas',
    'create images': 'image',
    image: 'image',
    video: 'video',
    audio: 'audio',
    'google search': 'web-search',
    search: 'web-search',
    apps: 'connected-apps',
  };

  const adapter = {
    id: 'google',
    provider: 'google',
    defaultSurface: 'gemini-web',
    hosts: ['gemini.google.com'],

    matchesLocation(url) {
      const host = url && url.host ? url.host : String(url || '');
      return this.hosts.some((h) => host.includes(h));
    },

    findComposer(scope) {
      return SH.firstMatch(scope || document, COMPOSER_SELECTORS);
    },

    findModelControls(scope) {
      const doc = scope || document;
      return SH.queryAll(doc, PICKER_SELECTORS)
        .concat(SH.queryAll(doc, MENU_SELECTORS))
        .concat(SH.queryAll(doc, REASONING_SELECTORS));
    },

    /** The thinking / Deep Think mode, read independently of the model. */
    readReasoning(scope) {
      return SH.readReasoningControl(scope || document, REASONING_SELECTORS, MENU_SELECTORS, 'google');
    },

    observeRoots(scope) {
      const doc = scope || document;
      const roots = SH.queryAll(doc, REGION_SELECTORS.concat(['[role="menu"]', '.mat-mdc-menu-panel']));
      return roots.length ? roots : [doc.body].filter(Boolean);
    },

    readSurface(scope, url) {
      const path = (url && url.pathname) || (typeof location !== 'undefined' ? location.pathname : '');
      if (/\/gem\//.test(path)) return 'gem';
      return 'gemini-web';
    },

    readConversationKey(url) {
      const path = (url && url.pathname) || (typeof location !== 'undefined' ? location.pathname : '');
      const id = SH.pathSegmentAfter(path, 'app') || SH.pathSegmentAfter(path, 'gem');
      return id ? `google:${id}` : null;
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

      SH.queryAll(doc, MENU_SELECTORS).forEach((el) => {
        const cand = SH.candidateFrom(el, 'google', {
          optionRow: true,
          nearComposer: SH.isNear(el, anchors),
        });
        cand.source = cand.selected ? 'selected-menu-item' : 'aria';
        out.push(cand);
      });

      // Per Google's help, this control sits with the text box — so it always
      // counts as composer-adjacent, which is exactly what the scoring rewards.
      SH.queryAll(doc, PICKER_SELECTORS).forEach((el) => {
        out.push(SH.candidateFrom(el, 'google', { source: 'picker-label', nearComposer: true }));
      });

      return out;
    },

    refine(obs) {
      const next = { ...obs };
      // Deep Think is both a named model and a reasoning mode; when it is what
      // was selected, both facts are recorded.
      if (next.canonicalModel === 'gemini-3.1-deep-think') next.reasoningMode = 'deep-think';
      if (next.surface === 'gem' && !next.canonicalModel) {
        // A Gem without an exposed base model is genuinely unknown, and saying so
        // is better than inheriting whatever model the last chat used.
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
        reasoning: this.readReasoning(doc),
        effectiveModel: o.effectiveModel || null,
        now: o.now,
      });
    },
  };

  const PFAdapterGoogle = adapter;
  if (root) root.PFAdapterGoogle = PFAdapterGoogle;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFAdapterGoogle;
})(typeof self !== 'undefined' ? self : this);
