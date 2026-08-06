// PromptFootprint Provider Adapter — shared assembly
// ---------------------------------------------------------------------------
// The three provider adapters differ only in their selectors and their
// product-specific quirks. Everything downstream of "here are the candidate
// controls" is identical, and lives here: score, pick, canonicalize, apply the
// vendor's documented model constraints, attach tools and the conversation key,
// and compute a confidence that reflects what is still unknown.
//
// Keeping this shared is what makes an adapter a small, readable list of
// selectors instead of a copy of the whole detection algorithm.

(function (root) {
  'use strict';

  const OBS = (typeof PFModelObservation !== 'undefined') ? PFModelObservation : require('../observation.js');
  const CAT = (typeof PFModelCatalog !== 'undefined') ? PFModelCatalog : require('../catalog.js');

  /** querySelectorAll over a list of selectors, de-duplicated, never throwing. */
  function queryAll(scope, selectors) {
    const out = [];
    const seen = new Set();
    (selectors || []).forEach((sel) => {
      let found = [];
      try { found = Array.from(scope.querySelectorAll(sel)); } catch (_) { found = []; }
      found.forEach((el) => { if (!seen.has(el)) { seen.add(el); out.push(el); } });
    });
    return out;
  }

  function firstMatch(scope, selectors) {
    for (const sel of selectors || []) {
      let el = null;
      try { el = scope.querySelector(sel); } catch (_) { el = null; }
      if (el) return el;
    }
    return null;
  }

  /** True when `el` sits inside one of the page regions the adapter trusts. */
  function isNear(el, anchors) {
    if (!el) return false;
    return (anchors || []).some((a) => a && (a === el || (a.contains && a.contains(el))));
  }

  /**
   * Tool/mode chips: visible controls that are switched ON. Read from
   * aria-pressed / aria-checked / data-state rather than from styling, and mapped
   * through the adapter's vocabulary so "Deep research" and "Deep Research"
   * become one canonical tool id.
   */
  function readToolChips(scope, selectors, vocabulary) {
    const active = [];
    // Longest phrase first, and one match per control: "Deep Research" contains
    // "search", and mapping a single chip to both deep-research and web-search
    // would double-count the same button.
    const needles = Object.keys(vocabulary).sort((a, b) => b.length - a.length);
    queryAll(scope, selectors).forEach((el) => {
      if (OBS.isHiddenElement(el)) return;
      const pressed = el.getAttribute && (
        el.getAttribute('aria-pressed') === 'true' ||
        el.getAttribute('aria-checked') === 'true' ||
        el.getAttribute('data-state') === 'on' ||
        el.getAttribute('data-state') === 'active' ||
        el.getAttribute('data-active') === 'true'
      );
      if (!pressed) return;
      const text = `${OBS.controlText(el)} ${OBS.accessibleName(el)}`.toLowerCase();
      const hit = needles.find((n) => text.includes(n));
      if (hit && !active.includes(vocabulary[hit])) active.push(vocabulary[hit]);
    });
    return active;
  }

  /**
   * Turn scored candidates into a ModelObservation.
   *
   * The two rules that matter most are here: an unresolved label is preserved as
   * `selectedLabel` with `canonicalModel: null` (never upgraded to a flagship),
   * and Auto routing keeps `canonicalModel: null` unless the page itself names
   * the model it routed to — in which case that name lands in `effectiveModel`,
   * where its provenance stays visible.
   */
  function buildObservation(adapter, ctx) {
    const c = ctx || {};
    const provider = adapter.provider;
    const candidates = c.candidates || [];
    const best = OBS.pickBest(candidates);

    let obs = OBS.emptyObservation({
      provider,
      surface: c.surface || adapter.defaultSurface,
      tools: c.tools || [],
      conversationKey: c.conversationKey || null,
      observedAt: c.now || Date.now(),
      // Control labels only — never prompt or response text.
      rawEvidence: candidates
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map((x) => `${x.source}:${(x.label || '').slice(0, 60)}(${x.score})`),
    });

    // Nothing cleared the floor. Before giving up entirely, keep the visible
    // picker's raw text: "Unknown model — 'GPT-7.2 Nimbus'" is far more useful
    // than "Unknown model", and it is the string a user would report to us when
    // a new tier ships and the catalog has not caught up yet.
    if (!best) {
      const fallback = candidates
        .filter((c) => c.source === 'picker-label' && !c.hidden && !c.unrelated)
        .sort((a, b) => b.score - a.score)[0];
      if (fallback && fallback.label) {
        obs.selectedLabel = fallback.label;
        obs.source = 'picker-label';
        obs.unmappedLabel = true;
      }
    }

    if (best) {
      obs.selectedLabel = best.label || null;
      obs.source = best.source || 'unknown';
      if (best.canon) {
        obs.canonicalModel = best.canon.canonicalModel;
        obs.family = best.canon.family;
        obs.tier = best.canon.tier;
      }
      if (best.mode) {
        if (best.mode.routing) obs.routing = best.mode.routing;
        if (best.mode.reasoning && best.mode.reasoning !== 'unknown') obs.reasoningMode = best.mode.reasoning;
      }
      if (obs.routing === 'auto') {
        // Selected intent is Auto. If the same control also names a model, that
        // name is what the product says it routed to — record it as EFFECTIVE,
        // and leave the selected model null so the uncertainty is not erased.
        if (obs.canonicalModel) {
          obs.effectiveModel = obs.canonicalModel;
          obs.canonicalModel = null;
        }
      } else if (obs.canonicalModel && obs.routing === 'unknown') {
        obs.routing = 'fixed';
      }
    }

    // Explicit response metadata, when a provider exposes it, outranks the picker
    // for the message it describes.
    if (c.effectiveModel) {
      obs.effectiveModel = c.effectiveModel;
      obs.source = 'response-metadata';
    }

    if (typeof adapter.refine === 'function') obs = adapter.refine(obs, c) || obs;
    obs = CAT.applyModelConstraints(obs);

    obs.confidence = OBS.confidenceFromScore(best ? best.score : 0, {
      routing: obs.routing,
      canonicalModel: obs.canonicalModel,
      effectiveModel: obs.effectiveModel,
      source: obs.source,
    });
    return obs;
  }

  /**
   * `adapter.observe(onChange)` — watch this adapter's roots and return the
   * teardown. The content script drives detection through PFModelDetector, which
   * owns one observer for the page; this is the standalone form of the same
   * thing, for callers that want an adapter on its own.
   */
  function observeAdapter(adapter, onChange, opts) {
    const o = opts || {};
    const doc = o.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) return function () {};
    const scoped = OBS.createScopedObserver({ document: doc, window: o.window, onChange });
    scoped.refresh(adapter.observeRoots(doc));
    return function () { scoped.destroy(); };
  }

  /** Path-segment reader used by every adapter's conversation key. */
  function pathSegmentAfter(pathname, marker) {
    const parts = String(pathname || '').split('/').filter(Boolean);
    const i = parts.indexOf(marker);
    if (i === -1 || i + 1 >= parts.length) return null;
    return parts[i + 1];
  }

  const PFAdapterShared = {
    queryAll,
    firstMatch,
    isNear,
    readToolChips,
    observeAdapter,
    buildObservation,
    pathSegmentAfter,
    candidateFrom: OBS.candidateFrom,
  };

  if (root) root.PFAdapterShared = PFAdapterShared;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFAdapterShared;
})(typeof self !== 'undefined' ? self : this);
