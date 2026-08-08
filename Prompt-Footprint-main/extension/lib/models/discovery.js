// PromptFootprint — observed-model discovery
// ---------------------------------------------------------------------------
// A new model tier ships on a Tuesday and the catalog in this extension is from
// last month. That is the normal case, not the exception, and the failure mode
// to avoid is not "we don't recognise it" — it is *pretending* we do.
//
// So an unmapped picker label is treated as two independent facts:
//
//   1. WHICH MODEL IS SELECTED. Fully known. The product told us, in the
//      picker, and the exact string is shown to the user unchanged. There is
//      no "Unknown model?" and no "Probably GPT-5.6" — the answer is the label.
//
//   2. WHAT IT COSTS. Not known. The estimate falls back to the provider-level
//      distribution and is flagged as a fallback, so the number carries its own
//      uncertainty instead of borrowing a named model's confidence.
//
// Discoveries are recorded locally so the registry can be updated for real
// later: label, normalized form, provider, first and last seen, and a count.
// Control labels only — never prompt text, never conversation content — and it
// never leaves the device on its own.

(function (root) {
  'use strict';

  const CAT = (typeof PFModelCatalog !== 'undefined') ? PFModelCatalog : require('./catalog.js');

  const STORAGE_KEY = 'pf_observed_models';
  /** A picker that renders a paragraph is not a model name. */
  const MAX_LABEL_CHARS = 80;
  /** Ring size. Old discoveries fall off; the newest are the useful ones. */
  const MAX_ENTRIES = 50;

  /**
   * Labels that are model-shaped but are NOT models: configuration names the
   * user wrote, and product modes. Recording these would fill the registry with
   * noise and, worse, suggest them as models to add.
   */
  const NOT_A_MODEL = /\b(?:project|gem|style|custom|assistant|agent|folder|workspace|untitled|new chat)\b/i;

  function chromeStorage() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) return chrome.storage.local;
    } catch (_) { /* not in an extension context */ }
    return null;
  }

  /**
   * Is this label worth recording as a model we have never seen?
   *
   * Deliberately strict. A discovery is a claim that a real model exists under
   * this name, and a registry full of half-captured button text is worse than
   * an empty one.
   */
  function isDiscoverable(provider, label) {
    const raw = String(label == null ? '' : label).trim();
    if (!raw || raw.length > MAX_LABEL_CHARS) return false;
    if (NOT_A_MODEL.test(raw)) return false;
    // Already known: not a discovery.
    if (CAT.canonicalize(provider, raw)) return false;
    const norm = CAT.normalizeLabel(raw);
    if (!norm) return false;
    // A model name carries a version number or a family word. Bare adjectives
    // and single verbs are chrome, not identities.
    return /\d/.test(norm) || /\b(?:gpt|claude|gemini|sonnet|opus|haiku|fable|mythos|sol|terra|luna|flash|nano|mini|turbo|ultra|pro)\b/.test(norm);
  }

  function nowMs(clock) {
    return typeof clock === 'function' ? clock() : Date.now();
  }

  /**
   * An in-memory registry that mirrors itself to chrome.storage.local.
   *
   * Reads are synchronous against the in-memory copy so a detection hot path
   * never awaits storage; persistence is best-effort and its failure is not
   * allowed to affect detection.
   */
  function createRegistry(options) {
    const o = options || {};
    const storage = o.storage !== undefined ? o.storage : chromeStorage();
    const limit = o.limit || MAX_ENTRIES;
    const clock = o.now;
    const log = o.log || function () {};
    /** key -> { provider, label, normalized, firstSeen, lastSeen, count } */
    const entries = new Map();
    let loaded = false;

    function key(provider, normalized) {
      return `${provider}|${normalized}`;
    }

    function persist() {
      if (!storage) return;
      try {
        storage.set({ [STORAGE_KEY]: list() });
      } catch (_) { /* storage is an optimization, never a requirement */ }
    }

    async function load() {
      if (loaded || !storage) { loaded = true; return list(); }
      loaded = true;
      try {
        const got = await new Promise((resolve) => {
          const maybe = storage.get([STORAGE_KEY], (v) => resolve(v));
          if (maybe && typeof maybe.then === 'function') maybe.then(resolve, () => resolve(null));
        });
        const stored = (got && got[STORAGE_KEY]) || [];
        for (const e of stored) {
          if (!e || !e.provider || !e.normalized) continue;
          entries.set(key(e.provider, e.normalized), {
            provider: e.provider,
            label: String(e.label || ''),
            normalized: String(e.normalized),
            firstSeen: Number(e.firstSeen) || 0,
            lastSeen: Number(e.lastSeen) || 0,
            count: Number(e.count) || 1,
          });
        }
      } catch (_) { /* corrupt or unavailable — start empty */ }
      return list();
    }

    /**
     * Record a label the catalog does not know.
     *
     * Returns the entry when it was recorded, null when the label was rejected
     * or is already a known model — so a caller can use the return value to
     * decide whether to mark an estimate as a fallback.
     */
    function record(provider, label) {
      if (!isDiscoverable(provider, label)) return null;
      const normalized = CAT.normalizeLabel(label);
      const k = key(provider, normalized);
      const at = nowMs(clock);
      const existing = entries.get(k);
      if (existing) {
        existing.lastSeen = at;
        existing.count += 1;
        persist();
        return existing;
      }
      const entry = {
        provider,
        label: String(label).trim(),
        normalized,
        firstSeen: at,
        lastSeen: at,
        count: 1,
      };
      entries.set(k, entry);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      // Structured enough to act on: this is what a registry update needs.
      log('model discovery:', JSON.stringify({
        provider, label: entry.label, normalized, catalogVersion: CAT.updatedAt,
      }));
      persist();
      return entry;
    }

    function list() {
      return [...entries.values()].sort((a, b) => b.lastSeen - a.lastSeen);
    }

    return {
      load,
      record,
      list,
      isDiscoverable,
      get size() { return entries.size; },
      clear() { entries.clear(); persist(); },
    };
  }

  const PFModelDiscovery = { createRegistry, isDiscoverable, STORAGE_KEY, MAX_ENTRIES, MAX_LABEL_CHARS };

  if (root) root.PFModelDiscovery = PFModelDiscovery;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFModelDiscovery;
})(typeof self !== 'undefined' ? self : this);
