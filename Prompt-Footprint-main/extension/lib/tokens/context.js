// PromptFootprint — everything the request is carrying, in one breakdown.
// ---------------------------------------------------------------------------
// Assembles the observable input from its pieces and hands the UI a structure
// it can render without doing any arithmetic of its own.
//
// THREE RULES, EACH OF WHICH THE OLD SINGLE NUMBER BROKE
//
//   1. NOTHING IS COUNTED TWICE. Text pasted into the composer becomes composer
//      text; it is a SUBDIVISION of that total, never an addition to it. See
//      `attributePastes` — the pasted line and the typed line always sum to the
//      composer's own count, whatever the user has done since.
//   2. NOTHING IS INVENTED. Hidden system prompts, tool schemas, retrieval
//      results, routing metadata, and reasoning tokens are all real input that a
//      browser extension cannot see. They are named as unmeasured, and no number
//      is attached to them.
//   3. NOTHING ESTIMATED IS CALLED EXACT. Confidence propagates upward: a
//      breakdown containing one estimated part is an estimated breakdown, and it
//      says which part made it so.

(function (root) {
  'use strict';

  const TC = (typeof PFTokenCounter !== 'undefined') ? PFTokenCounter : require('./counter.js');
  const CAT = (typeof PFModelCatalog !== 'undefined') ? PFModelCatalog : require('../models/catalog.js');

  /**
   * Pasted runs shorter than this are not worth breaking out.
   *
   * Pasting a word or a URL is typing; pasting a document is not, and only the
   * second is information the user wants back. The threshold keeps the
   * breakdown to lines that mean something.
   */
  const PASTE_MIN_CHARS = 400;

  /** How many pasted runs to track before the oldest is forgotten. */
  const MAX_TRACKED_PASTES = 24;

  /**
   * Input the extension provably cannot observe.
   *
   * Listed rather than estimated. Each of these genuinely enters the model's
   * context and none of it is visible from a content script, so the honest
   * presentation is a named absence — which is also what lets the headline
   * number be called "observable input" rather than "input".
   */
  const UNMEASURED = [
    'the platform’s own system prompt and app instructions',
    'tool and function definitions',
    'earlier turns of this conversation',
    'memory, custom instructions, and project or GPT configuration',
    'search or retrieval results the model pulls in',
    'reasoning tokens the model generates before answering',
  ];

  function createContext(options) {
    const o = options || {};
    const getTarget = typeof o.getTarget === 'function' ? o.getTarget : () => null;
    const getSurface = typeof o.getSurface === 'function' ? o.getSurface : () => null;
    const tracker = o.tracker || null;

    // Pasted runs, newest last. Kept as raw strings only so they can be located
    // in the composer text; dropped as soon as they are no longer there.
    let pastes = [];

    /** Record a paste. Called from the composer's own paste handler. */
    function notePaste(text) {
      const s = typeof text === 'string' ? text : '';
      if (s.length < PASTE_MIN_CHARS) return false;
      if (pastes.includes(s)) return false;
      pastes.push(s);
      if (pastes.length > MAX_TRACKED_PASTES) pastes.shift();
      return true;
    }

    function reset() {
      pastes = [];
      if (tracker && typeof tracker.reset === 'function') tracker.reset('context-reset');
    }

    /**
     * Which tracked pastes are still in the composer, without overlapping.
     *
     * Two things have to be right here. A paste the user has since deleted or
     * rewritten must stop counting — so presence is re-checked against the live
     * text rather than remembered. And a paste contained inside a larger paste
     * (paste a document, then paste the whole composer somewhere and back) must
     * be counted once — so longer runs claim their span first and shorter ones
     * nested inside are dropped.
     */
    function attributePastes(composerText) {
      const present = pastes
        .filter((p) => composerText.includes(p))
        .sort((a, b) => b.length - a.length);
      const claimed = [];
      const kept = [];
      for (const paste of present) {
        const at = composerText.indexOf(paste);
        const span = { start: at, end: at + paste.length };
        const overlaps = claimed.some((c) => span.start < c.end && span.end > c.start);
        if (overlaps) continue;
        claimed.push(span);
        kept.push(paste);
      }
      // Forget pastes that are no longer in the composer, so an edited-away
      // paste cannot come back when similar text is typed later.
      pastes = pastes.filter((p) => composerText.includes(p));
      return kept;
    }

    /** The model's documented context window, or null when we do not know it. */
    function contextWindow(target) {
      const t = target || {};
      if (!t.provider || !t.canonicalModel) return null;
      const meta = CAT.modelMeta(t.provider, t.canonicalModel);
      if (!meta || !meta.contextTokens) return null;
      return meta.contextTokens;
    }

    /**
     * Build the breakdown.
     *
     * `composerText` is what the composer holds right now; attachments come from
     * the tracker. Everything is costed against the CURRENT target, so a model
     * switch changes every line in one pass.
     */
    function compose(composerText) {
      const target = getTarget();
      const surface = getSurface();
      const text = typeof composerText === 'string' ? composerText : '';
      const counted = TC.countText(text, target);

      const parts = [];
      const pasted = attributePastes(text);

      if (pasted.length) {
        // Count each pasted run on its own, then give the typed line the
        // REMAINDER of the composer's own total rather than counting it
        // separately. That is what makes the lines sum to the composer count
        // exactly, instead of to the composer count plus a rounding drift.
        let pastedTokens = 0;
        for (const paste of pasted) pastedTokens += TC.countText(paste, target).count;
        pastedTokens = Math.min(pastedTokens, counted.count);
        const typed = counted.count - pastedTokens;
        if (typed > 0) {
          parts.push({
            id: 'typed', kind: 'text', label: 'Prompt text', tokens: typed,
            low: Math.round(typed * 0.92), high: Math.round(typed * 1.08),
            confidence: counted.confidence,
            detail: 'what you typed, tokenized with the detected model’s tokenizer',
          });
        }
        parts.push({
          id: 'pasted', kind: 'text',
          label: pasted.length === 1 ? 'Pasted content' : `Pasted content (${pasted.length})`,
          tokens: pastedTokens,
          low: Math.round(pastedTokens * 0.92), high: Math.round(pastedTokens * 1.08),
          confidence: counted.confidence,
          detail: `${pasted.reduce((n, p) => n + p.length, 0).toLocaleString()} pasted characters, `
            + 'counted as the text they actually are — not as a flat allowance',
        });
      } else if (counted.count > 0) {
        parts.push({
          id: 'typed', kind: 'text', label: 'Prompt text', tokens: counted.count,
          low: counted.low, high: counted.high,
          confidence: counted.confidence,
          detail: counted.reason,
        });
      }

      const attachments = tracker ? tracker.attachments() : [];
      for (const file of attachments) {
        parts.push({
          id: `file:${file.name}`,
          kind: file.kind,
          label: file.name,
          tokens: file.total || 0,
          low: file.low || 0,
          high: file.high || 0,
          confidence: file.confidence,
          detail: file.detail,
          pending: !!file.pending,
          unreadable: !!file.unreadable,
          textTokens: file.textTokens || 0,
          visualTokens: file.visualTokens || 0,
          pages: file.pages,
        });
      }

      const total = parts.reduce((n, p) => n + (p.tokens || 0), 0);
      const low = parts.reduce((n, p) => n + (p.low || 0), 0);
      const high = parts.reduce((n, p) => n + (p.high || 0), 0);

      // The weakest link decides. A breakdown whose PDF line is a band is an
      // estimated breakdown however precisely its typed line was counted.
      const RANK = { unknown: 0, low: 1, estimated: 2, high: 3, exact: 4 };
      let confidence = parts.length ? 'exact' : counted.confidence;
      for (const part of parts) {
        if (!part.confidence) continue;
        if (RANK[part.confidence] < RANK[confidence]) confidence = part.confidence;
      }
      // Nothing here is ever exact — see lib/tokens/counter.js. If every part
      // came back 'high', the whole is 'high', not 'exact'.
      if (confidence === 'exact') confidence = 'high';

      const window = contextWindow(target);
      const hasAttachments = attachments.length > 0;

      return {
        total,
        low,
        high,
        parts,
        attachments,
        confidence,
        method: counted.method,
        provider: counted.provider,
        model: counted.model,
        tokenizer: counted.tokenizer,
        surface,
        // Percentages only when the model's own documented window is known.
        // A guessed denominator makes a real numerator look like a fabrication.
        contextTokens: window,
        contextPercent: window ? (total / window) * 100 : null,
        contextNote: window
          ? 'Share of the model’s documented context window; your plan may allow less.'
          : null,
        pending: attachments.some((a) => a.pending),
        unmeasured: UNMEASURED,
        // The one-line honesty statement the UI puts under the headline.
        headlineLabel: hasAttachments ? 'Observable input' : 'User-supplied input',
      };
    }

    return { compose, notePaste, reset, get pasteCount() { return pastes.length; } };
  }

  const PFContext = {
    PASTE_MIN_CHARS,
    MAX_TRACKED_PASTES,
    UNMEASURED,
    createContext,
  };

  if (root) root.PFContext = PFContext;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFContext;
})(typeof self !== 'undefined' ? self : this);
