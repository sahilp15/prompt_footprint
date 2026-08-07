// PromptFootprint Per-Message Model Snapshots
// ---------------------------------------------------------------------------
// "Which model was this message sent with?" is a question about the past, and
// the current picker is not the answer. If a user sends one prompt on Opus and
// then switches to Sonnet, the first message is still an Opus message forever.
//
// So at send time we freeze what was true: the observation, the token count, and
// the pre-send estimate. Later picker changes cannot touch it. The only thing
// that may amend a snapshot is the provider itself telling us, through exposed
// response metadata, which model actually served THAT response — and even then
// only that one snapshot changes.
//
// The prompt text is never stored. A non-reversible local hash is kept so the
// same prompt can be recognised (dedup, undo) without retaining the content.

(function (root) {
  'use strict';

  /**
   * FNV-1a, 32-bit, plus the length. Non-reversible and fast enough to run on
   * every send. It is an identity check, not a security primitive — and it
   * exists precisely so the prompt itself never has to be kept.
   */
  function hashPrompt(text) {
    const s = String(text == null ? '' : text);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `pf1:${h.toString(16).padStart(8, '0')}:${s.length}`;
  }

  /** Structural clone that also drops DOM references and functions. */
  function freeze(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return null;
    }
  }

  let counter = 0;
  function nextId(now) {
    counter += 1;
    return `snap-${now}-${counter}`;
  }

  /**
   * An in-memory ring of send snapshots. `limit` keeps a long session from
   * growing without bound; the oldest entries fall off first.
   */
  function createStore(options) {
    const o = options || {};
    const limit = o.limit || 200;
    const items = [];

    function create(entry) {
      const e = entry || {};
      const sentAt = e.sentAt || Date.now();
      const snapshot = {
        id: e.id || nextId(sentAt),
        conversationKey: e.conversationKey || (e.observation && e.observation.conversationKey) || null,
        sentAt,
        // Never the prompt itself.
        promptHash: hashPrompt(e.promptText || ''),
        inputTokens: e.inputTokens || 0,
        observation: freeze(e.observation),
        estimateBeforeSend: freeze(e.estimate || e.estimateBeforeSend),
        estimateAfterResponse: null,
        effectiveModelSource: null,
        generation: (e.observation && e.observation.generation) || 0,
      };
      items.push(snapshot);
      while (items.length > limit) items.shift();
      return snapshot;
    }

    function get(id) {
      return items.find((s) => s.id === id) || null;
    }

    function latest(conversationKey) {
      for (let i = items.length - 1; i >= 0; i--) {
        if (!conversationKey || items[i].conversationKey === conversationKey) return items[i];
      }
      return null;
    }

    /**
     * Attach the completed-interaction estimate once output is observable.
     * The pre-send estimate is kept untouched beside it: the two answer different
     * questions and overwriting one with the other would erase the record of what
     * the user was actually shown before they hit send.
     */
    function complete(id, estimate) {
      const snap = get(id);
      if (!snap) return null;
      snap.estimateAfterResponse = freeze(estimate);
      return snap;
    }

    /**
     * Refine ONE snapshot with an effective model the provider exposed. This is
     * the only path that may change a sent message's model, and it can never run
     * off the current picker — it needs metadata naming the model for that
     * response.
     */
    function refineEffectiveModel(id, info) {
      const snap = get(id);
      if (!snap || !info || !info.effectiveModel) return null;
      if (!snap.observation) return null;
      snap.observation = { ...snap.observation, effectiveModel: info.effectiveModel, source: 'response-metadata' };
      snap.effectiveModelSource = info.source || 'response-metadata';
      if (info.estimate) snap.estimateAfterResponse = freeze(info.estimate);
      return snap;
    }

    return {
      create,
      get,
      latest,
      complete,
      refineEffectiveModel,
      list() { return items.slice(); },
      clear() { items.length = 0; },
      get size() { return items.length; },
    };
  }

  const PFPromptSnapshots = { hashPrompt, createStore, freeze };

  if (root) root.PFPromptSnapshots = PFPromptSnapshots;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFPromptSnapshots;
})(typeof self !== 'undefined' ? self : this);
