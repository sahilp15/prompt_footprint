// PromptFootprint Model Observation
// ---------------------------------------------------------------------------
// The shape of "what model is this page using?", plus the scoring that decides
// which of several model-ish labels on a page is the real one.
//
// A chat page contains many strings that look like a model name: the open menu,
// the closed menu still in the DOM, a settings dialog, a template clone, the
// conversation title, marketing copy. Picking one with a single CSS selector is
// how detection silently breaks the week after a redesign. Instead every
// candidate is scored on independent semantic signals — is it the SELECTED
// option, does it contain a known model token, is it near the composer, is it
// actually visible — and the winner must clear a floor. If nothing clears it,
// the answer is "unknown", which is a valid and useful answer.
//
// Nothing here reads prompt text. Candidates carry control labels only.

(function (root) {
  'use strict';

  const _Cat = (typeof PFModelCatalog !== 'undefined') ? PFModelCatalog : require('./catalog.js');

  // ── Scoring ──────────────────────────────────────────────────────────────

  const SCORE = {
    SELECTED: 40,        // aria-selected / aria-checked / data-state=checked
    EXACT_TOKEN: 25,     // contains a known model or mode token
    NEAR_COMPOSER: 20,   // lives in the composer or the top bar
    ARIA_TERMS: 15,      // accessible name mentions model/mode terms
    VISIBLE: 10,         // rendered and enabled right now
    HIDDEN: -30,         // hidden, collapsed menu, or a <template> clone
    UNSELECTED_OPTION: -30, // a row in an open menu that is NOT the current one
    UNRELATED: -25,      // destructive or settings control that merely has text
  };

  /** A candidate must clear this to be trusted; below it we report unknown. */
  const MIN_SCORE = 35;

  const MODEL_TERMS = /\b(model|gpt|chatgpt|claude|gemini|sonnet|opus|fable|mythos|haiku|sol|terra|luna|flash|pro|thinking|deep\s*think|instant|auto)\b/i;
  const UNRELATED_TERMS = /\b(delete|remove|clear|discard|log ?out|sign ?out|settings|preferences|share|archive|report|upgrade|subscribe|billing)\b/i;

  function scoreCandidate(c) {
    const cand = c || {};
    let score = 0;
    if (cand.selected) score += SCORE.SELECTED;
    if (cand.exactToken) score += SCORE.EXACT_TOKEN;
    if (cand.nearComposer) score += SCORE.NEAR_COMPOSER;
    if (cand.ariaTerms) score += SCORE.ARIA_TERMS;
    if (cand.visible && !cand.disabled) score += SCORE.VISIBLE;
    if (cand.hidden) score += SCORE.HIDDEN;
    // An open menu lists every model the account can pick. Only the row the
    // product marks as current describes the present state; the others are
    // offers, and without this penalty the first alternative in the list would
    // beat the picker button purely by being visible and near the composer.
    if (cand.unselectedOption) score += SCORE.UNSELECTED_OPTION;
    if (cand.unrelated) score += SCORE.UNRELATED;
    return score;
  }

  /** Highest score wins; ties keep DOM order, which favours the earlier control. */
  function pickBest(candidates, minScore) {
    const floor = typeof minScore === 'number' ? minScore : MIN_SCORE;
    let best = null;
    (candidates || []).forEach((c, index) => {
      const score = typeof c.score === 'number' ? c.score : scoreCandidate(c);
      if (score < floor) return;
      if (!best || score > best.score) best = { ...c, score, index };
    });
    return best;
  }

  /**
   * Confidence in 0..1. Score sets the ceiling; every remaining unknown lowers it.
   * Auto routing without exposed metadata can never read as certain, and an
   * unmapped label is capped low no matter how cleanly it was found.
   */
  function confidenceFromScore(score, opts) {
    const o = opts || {};
    let c = Math.max(0, Math.min(1, (score - 10) / 80));
    if (o.routing === 'auto' && !o.effectiveModel) c = Math.min(c, 0.5);
    if (!o.canonicalModel) c = Math.min(c, 0.35);
    if (o.source === 'provider-default') c = Math.min(c, 0.3);
    return Math.round(c * 100) / 100;
  }

  // ── The observation record ───────────────────────────────────────────────

  function emptyObservation(partial) {
    return {
      provider: 'unknown',
      surface: 'unknown',
      selectedLabel: null,
      canonicalModel: null,
      family: null,
      tier: null,
      reasoningMode: null,
      routing: 'unknown',
      effectiveModel: null,
      tools: [],
      source: 'unknown',
      confidence: 0,
      rawEvidence: [],
      observedAt: Date.now(),
      conversationKey: null,
      generation: 0,
      ...(partial || {}),
    };
  }

  /** Fields whose change means "this is a different model/mode situation". */
  const IDENTITY_FIELDS = ['provider', 'surface', 'selectedLabel', 'canonicalModel', 'reasoningMode', 'routing', 'effectiveModel', 'conversationKey'];

  function observationsEqual(a, b) {
    if (!a || !b) return a === b;
    for (const f of IDENTITY_FIELDS) {
      if (a[f] !== b[f]) return false;
    }
    return (a.tools || []).join('|') === (b.tools || []).join('|');
  }

  // ── DOM helpers (shared by the provider adapters) ────────────────────────

  const SELECTED_ATTRS = [
    ['aria-selected', 'true'],
    ['aria-checked', 'true'],
    ['data-state', 'checked'],
    ['aria-current', 'true'],
  ];

  function isSelectedOption(el) {
    if (!el || !el.getAttribute) return false;
    for (const [attr, value] of SELECTED_ATTRS) {
      if (el.getAttribute(attr) === value) return true;
    }
    // Some pickers mark the active row by rendering a check icon inside it
    // rather than by an ARIA attribute.
    if (el.querySelector && el.querySelector('[data-testid*="check" i], [aria-label*="selected" i]')) return true;
    return false;
  }

  /**
   * Hidden for our purposes: not rendered, explicitly hidden from a11y, inside a
   * closed menu, or a <template>. jsdom has no layout, so this deliberately reads
   * semantics and inline style rather than measuring boxes.
   */
  function isHiddenElement(el) {
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 30) {
      if (node.hasAttribute) {
        if (node.hasAttribute('hidden')) return true;
        if (node.getAttribute('aria-hidden') === 'true') return true;
        if (node.hasAttribute('inert')) return true;
        if (node.getAttribute('data-state') === 'closed') return true;
      }
      if (node.tagName === 'TEMPLATE') return true;
      const style = node.style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
      node = node.parentElement;
      depth += 1;
    }
    return false;
  }

  function isDisabled(el) {
    if (!el) return false;
    if (el.disabled) return true;
    return el.getAttribute && (el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'));
  }

  /** Visible label text of a control, with nested icon/badge noise squeezed out. */
  function controlText(el) {
    if (!el) return '';
    const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return raw.slice(0, 120);
  }

  /** Accessible name: aria-label, then title, then the visible text. */
  function accessibleName(el) {
    if (!el || !el.getAttribute) return '';
    return (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
  }

  /**
   * Build a scored candidate from an element. `provider` decides which tokens
   * count as "exact", so a Gemini string on a ChatGPT page cannot win.
   */
  function candidateFrom(el, provider, opts) {
    const o = opts || {};
    const text = controlText(el);
    const aria = accessibleName(el);
    const label = text || aria;
    const canon = _Cat.canonicalize(provider, label);
    const mode = _Cat.readMode(provider, label);
    const hidden = isHiddenElement(el);
    const selected = !!o.selected || isSelectedOption(el);
    const cand = {
      element: el,
      label,
      text,
      aria,
      selected,
      unselectedOption: !!o.optionRow && !selected,
      exactToken: !!(canon || mode),
      nearComposer: !!o.nearComposer,
      ariaTerms: MODEL_TERMS.test(aria),
      visible: !hidden,
      hidden,
      disabled: isDisabled(el),
      unrelated: UNRELATED_TERMS.test(aria) || UNRELATED_TERMS.test(text),
      source: o.source || 'unknown',
      canon,
      mode,
    };
    cand.score = scoreCandidate(cand);
    return cand;
  }

  /**
   * A MutationObserver scoped to the smallest stable ancestors an adapter names,
   * rather than the whole document. Re-pointing it (`refresh`) disconnects first,
   * so a React re-render that swaps the picker node rebinds cleanly instead of
   * stacking a second observer on the replacement.
   */
  function createScopedObserver(options) {
    const o = options || {};
    const doc = o.document || (typeof document !== 'undefined' ? document : null);
    const win = o.window || (typeof window !== 'undefined' ? window : null);
    const ObserverCtor = (win && win.MutationObserver) || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    if (!doc || !ObserverCtor) {
      return { refresh() {}, destroy() {}, get roots() { return []; } };
    }
    const attributeFilter = o.attributeFilter || [
      'aria-label', 'aria-checked', 'aria-selected', 'aria-current', 'aria-expanded',
      'data-state', 'data-testid', 'title', 'class',
    ];
    let observer = new ObserverCtor(() => { if (o.onChange) o.onChange(); });
    let current = [];

    function bind(roots) {
      observer.disconnect();
      current = (roots || []).filter(Boolean);
      const targets = current.length ? current : [doc.body].filter(Boolean);
      targets.forEach((el) => {
        observer.observe(el, {
          childList: true, subtree: true, characterData: true,
          attributes: true, attributeFilter,
        });
      });
      // A root can be REPLACED rather than mutated — React swaps the whole
      // header or composer subtree on navigation — and a mutation of a detached
      // node is a mutation nobody is listening to. Watching each root's parent
      // for child changes (shallow, so it stays cheap) is what makes the swap
      // visible, and is what lets the observer rebind onto the new node.
      const parents = new Set();
      targets.forEach((el) => { if (el.parentElement && !targets.includes(el.parentElement)) parents.add(el.parentElement); });
      parents.forEach((p) => observer.observe(p, { childList: true }));
      return current;
    }

    return {
      refresh(roots) { return bind(roots); },
      destroy() {
        if (observer) observer.disconnect();
        observer = null;
        current = [];
      },
      get roots() { return current.slice(); },
    };
  }

  const PFModelObservation = {
    SCORE,
    MIN_SCORE,
    MODEL_TERMS,
    UNRELATED_TERMS,
    IDENTITY_FIELDS,
    scoreCandidate,
    pickBest,
    confidenceFromScore,
    emptyObservation,
    observationsEqual,
    isSelectedOption,
    isHiddenElement,
    isDisabled,
    controlText,
    accessibleName,
    candidateFrom,
    createScopedObserver,
  };

  if (root) root.PFModelObservation = PFModelObservation;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFModelObservation;
})(typeof self !== 'undefined' ? self : this);
