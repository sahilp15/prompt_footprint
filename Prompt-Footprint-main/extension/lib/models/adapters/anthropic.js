// PromptFootprint — Anthropic / Claude model adapter
// ---------------------------------------------------------------------------
// Claude exposes a base model AND, separately, an effort/thinking level and a
// set of tool modes. They are read as three independent things:
//
//   • the model         Fable / Opus / Sonnet / Haiku / Mythos
//   • the effort        low / medium / high / xhigh / max / adaptive thinking
//   • the tools         Research, web, artifacts, code execution, computer use
//
// Two vendor rules are enforced downstream in the catalog rather than guessed
// here: Fable 5's adaptive thinking is always on and cannot be disabled, and
// Opus 5's thinking is on by default and cannot be disabled at xhigh or max.
//
// Projects and styles are NOT models. A project called "Opus migration" must
// never resolve to Opus, so project and style names are deliberately excluded
// from the candidate set instead of being filtered out afterwards. [S9][S10]

(function (root) {
  'use strict';

  const SH = (typeof PFAdapterShared !== 'undefined') ? PFAdapterShared : require('./shared.js');

  const PICKER_SELECTORS = [
    '[data-testid="model-selector-dropdown"]',
    '[data-testid="model-selector"]',
    'button[data-testid*="model" i]',
    'button[aria-label*="model" i]',
    'button[aria-haspopup="listbox"][id*="model" i]',
  ];

  const MENU_SELECTORS = [
    '[role="menu"] [role="menuitemradio"]',
    '[role="menu"] [role="menuitem"]',
    '[role="listbox"] [role="option"]',
  ];

  const EFFORT_SELECTORS = [
    '[data-testid*="effort" i]',
    '[data-testid*="thinking" i]',
    'button[aria-label*="effort" i]',
    'button[aria-label*="thinking" i]',
  ];

  const COMPOSER_SELECTORS = [
    'div[contenteditable="true"].ProseMirror',
    'fieldset div[contenteditable="true"]',
    'div[contenteditable="true"]',
  ];

  const REGION_SELECTORS = ['header', 'fieldset', 'main', '[data-testid="chat-input-container"]'];

  const TOOL_SELECTORS = [
    'fieldset button',
    'button[aria-pressed]',
    '[role="button"][aria-pressed]',
    '[data-testid*="tool" i]',
  ];

  const TOOL_VOCABULARY = {
    research: 'deep-research',
    'web search': 'web-search',
    search: 'web-search',
    artifacts: 'artifacts',
    analysis: 'code-execution',
    'code execution': 'code-execution',
    'computer use': 'computer-use',
    drive: 'connected-apps',
    connectors: 'connected-apps',
  };

  const adapter = {
    id: 'anthropic',
    provider: 'anthropic',
    defaultSurface: 'claude-web',
    hosts: ['claude.ai'],

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
        .concat(SH.queryAll(doc, EFFORT_SELECTORS));
    },

    observeRoots(scope) {
      const doc = scope || document;
      const roots = SH.queryAll(doc, REGION_SELECTORS.concat(['[role="menu"]', '[role="listbox"]']));
      return roots.length ? roots : [doc.body].filter(Boolean);
    },

    readSurface() {
      // A Project scopes context and instructions; it does not change the model
      // identity, and its name is user-written. The surface stays claude-web.
      return 'claude-web';
    },

    readConversationKey(url) {
      const path = (url && url.pathname) || (typeof location !== 'undefined' ? location.pathname : '');
      const id = SH.pathSegmentAfter(path, 'chat') || SH.pathSegmentAfter(path, 'project');
      return id ? `anthropic:${id}` : null;
    },

    /** Watch this adapter's roots; returns the teardown. */
    observe(onChange, opts) {
      return SH.observeAdapter(this, onChange, opts);
    },

    readToolModes(scope) {
      return SH.readToolChips(scope || document, TOOL_SELECTORS, TOOL_VOCABULARY);
    },

    /** The effort/thinking control, read separately from the model itself. */
    readEffort(scope) {
      const doc = scope || document;
      const els = SH.queryAll(doc, EFFORT_SELECTORS);
      for (const el of els) {
        const cand = SH.candidateFrom(el, 'anthropic', { source: 'picker-label' });
        if (cand.hidden) continue;
        if (cand.mode && cand.mode.reasoning) return cand.mode.reasoning;
      }
      // A selected effort row inside an open menu.
      const rows = SH.queryAll(doc, MENU_SELECTORS);
      for (const el of rows) {
        const cand = SH.candidateFrom(el, 'anthropic', { optionRow: true });
        if (!cand.selected || cand.hidden) continue;
        if (!cand.canon && cand.mode && cand.mode.reasoning) return cand.mode.reasoning;
      }
      return null;
    },

    collectCandidates(scope) {
      const doc = scope || document;
      const anchors = SH.queryAll(doc, REGION_SELECTORS);
      const out = [];

      SH.queryAll(doc, MENU_SELECTORS).forEach((el) => {
        const cand = SH.candidateFrom(el, 'anthropic', {
          optionRow: true,
          nearComposer: SH.isNear(el, anchors),
        });
        cand.source = cand.selected ? 'selected-menu-item' : 'aria';
        out.push(cand);
      });

      SH.queryAll(doc, PICKER_SELECTORS).forEach((el) => {
        out.push(SH.candidateFrom(el, 'anthropic', { source: 'picker-label', nearComposer: true }));
      });

      return out;
    },

    refine(obs, ctx) {
      const next = { ...obs };
      const effort = (ctx && ctx.effort) || null;
      // Effort is its own control; it must not overwrite an adaptive/locked mode
      // the model itself imposes, which applyModelConstraints re-asserts after.
      if (effort) next.reasoningMode = effort;
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
        effort: this.readEffort(doc),
        effectiveModel: o.effectiveModel || null,
        now: o.now,
      });
    },
  };

  const PFAdapterAnthropic = adapter;
  if (root) root.PFAdapterAnthropic = PFAdapterAnthropic;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFAdapterAnthropic;
})(typeof self !== 'undefined' ? self : this);
