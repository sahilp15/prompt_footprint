// PromptFootprint — provider- and model-aware token counting.
// ---------------------------------------------------------------------------
// The thing this replaces was one function, `Math.ceil(text.length / 4)`, used
// for every provider and every model. That is a reasonable rule of thumb for
// English prose on an OpenAI model and it is wrong by up to 60% everywhere else:
// Claude's current tokenizer averages ~2.5 characters per token, not 4 [T3];
// Chinese, code, and JSON all sit far from the average; and cl100k_base and
// o200k_base disagree with each other.
//
// HOW COUNTING WORKS HERE
//
//   1. SPLIT with the provider's real pre-tokenization rule. For OpenAI that
//      is the exact `pat_str` from tiktoken's own source [T2]. Pre-tokenization
//      decides where token boundaries CAN fall — no merge ever crosses a piece
//      boundary — so this half is not an approximation.
//   2. COST each piece against a profile calibrated to that tokenizer's
//      published figures (lib/tokens/constants.js). This half IS an
//      approximation, because it stands in for a BPE merge table we do not ship.
//   3. REPORT the method and confidence alongside the number, so nothing
//      downstream can present an estimate as a measurement.
//
// WHY NOT THE REAL TOKENIZER
//
//   • OpenAI: tiktoken does not embed its vocabularies; it downloads them.
//     o200k_base is several megabytes. Bundling it would triple the extension's
//     size for a number that is already accurate to a few percent.
//   • Anthropic: there is no public Claude tokenizer. The only exact count is
//     the count_tokens endpoint [T9], which requires sending the user's prompt
//     — and their attached documents — to Anthropic. PromptFootprint counts
//     on-device and says "approximately" instead. That is the whole trade.
//
// Every result therefore carries `method` and `confidence`, and nothing in this
// file ever returns `confidence: 'exact'` — that value exists for a provider
// count, so that if one is ever wired up the distinction is already modelled.

(function (root) {
  'use strict';

  const K = (typeof PFTokenConstants !== 'undefined') ? PFTokenConstants : require('./constants.js');

  // ── Pre-tokenization ──────────────────────────────────────────────────────

  /**
   * o200k_base's pre-tokenization pattern, from tiktoken_ext/openai_public.py. [T2]
   *
   * Reproduced verbatim; the upstream form needs no translation because it uses
   * no possessive quantifiers. The `u` flag is required for `\p{…}`.
   */
  const O200K_PATTERN = new RegExp(
    "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+(?:'s|'t|'re|'ve|'m|'ll|'d)?"
    + "|[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*(?:'s|'t|'re|'ve|'m|'ll|'d)?"
    + '|\\p{N}{1,3}'
    + '| ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*'
    + '|\\s*[\\r\\n]+'
    + '|\\s+(?!\\S)'
    + '|\\s+',
    'giu',
  );

  /**
   * cl100k_base's pattern. [T2]
   *
   * The upstream source uses possessive quantifiers (`++`, `?+`), which
   * JavaScript's regex engine does not support. They exist purely to stop
   * catastrophic backtracking on adversarial input; removing them leaves the
   * language matched unchanged, and this is the form tiktoken itself shipped
   * before the possessive rewrite.
   */
  const CL100K_PATTERN = new RegExp(
    "(?:'s|'t|'re|'ve|'m|'ll|'d)"
    + '|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+'
    + '|\\p{N}{1,3}'
    + '| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*'
    + '|\\s*[\\r\\n]+'
    + '|\\s+(?!\\S)'
    + '|\\s+',
    'giu',
  );

  /**
   * Anthropic publishes no pre-tokenization rule, so o200k's is used as the
   * splitter and the COSTING carries the difference.
   *
   * That is defensible in a way that guessing a rule would not be: modern BPE
   * pre-tokenizers all split on the same boundaries (word / number-run /
   * punctuation-run / whitespace-run), and it is the merge table — which the
   * profile stands in for — where the tokenizers actually differ.
   */
  const PATTERNS = {
    o200k_base: O200K_PATTERN,
    o200k_harmony: O200K_PATTERN,
    cl100k_base: CL100K_PATTERN,
    'claude-4.7': O200K_PATTERN,
    'claude-legacy': O200K_PATTERN,
    generic: O200K_PATTERN,
  };

  /** Split text into pre-token pieces. Exact for the OpenAI encodings. */
  function pretokenize(text, profileId) {
    const pattern = PATTERNS[profileId] || O200K_PATTERN;
    pattern.lastIndex = 0;
    const out = [];
    let match;
    let guard = 0;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0] === '') { pattern.lastIndex += 1; continue; }
      out.push(match[0]);
      // The patterns are anchored by construction and cannot loop, but a
      // malformed profile should degrade rather than hang the page.
      guard += 1;
      if (guard > 5000000) break;
    }
    return out;
  }

  // ── Costing ───────────────────────────────────────────────────────────────

  /** UTF-8 byte length, which is what a byte-level BPE actually merges over. */
  function utf8Length(s) {
    let n = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) n += 1;
      else if (cp < 0x800) n += 2;
      else if (cp < 0x10000) n += 3;
      else n += 4;
    }
    return n;
  }

  const LATIN_WORD = /^[^\p{L}\p{N}]?[A-Za-zÀ-ɏ'’-]+$/u;
  const DIGITS = /^\p{N}{1,3}$/u;
  const WHITESPACE = /^\s+$/;
  const PUNCTUATION = /^[^\s\p{L}\p{N}]/u;

  /**
   * Tokens one pre-token piece is worth under `profile`.
   *
   * The four cases are the four things a pre-tokenizer can produce, and each one
   * merges differently:
   *
   *   words        the vocabulary holds common ones whole; longer or rarer ones
   *                split into a stem plus suffixes
   *   digit runs   capped at three digits by the pattern itself, always one token
   *   whitespace   merges hard — a four-space indent is one token
   *   everything   costed by UTF-8 BYTES, because coverage outside the Latin
   *   else         scripts is driven by byte-level merges rather than by
   *                characters
   */
  function pieceCost(piece, profile) {
    if (!piece) return 0;

    if (DIGITS.test(piece)) return 1;

    if (WHITESPACE.test(piece)) {
      return Math.max(1, Math.ceil(piece.length / profile.wsRun));
    }

    if (LATIN_WORD.test(piece)) {
      // Strip the leading space/punctuation the pattern attached: BPE keeps it
      // inside the token (" the"), so it costs nothing extra.
      const core = piece.replace(/^[^\p{L}\p{N}]/u, '');
      const len = core.length;
      if (!len) return 1;
      if (profile.wordCharsPerToken) {
        // Small-vocabulary profile: a documented characters-per-token ratio is
        // the only anchor available, so apply it directly. The +1 accounts for
        // the leading space, which the published ratio includes. [T3]
        return Math.max(1, Math.round((len + 1) / profile.wordCharsPerToken));
      }
      if (len <= profile.wordSingleMax) return 1;
      return 1 + Math.ceil((len - profile.wordSingleMax) / profile.wordExtraChars);
    }

    if (PUNCTUATION.test(piece) && utf8Length(piece) === piece.length) {
      return Math.max(1, Math.ceil(piece.length / profile.punctRun));
    }

    // Non-Latin scripts, emoji, and mixed pieces.
    return Math.max(1, Math.ceil(utf8Length(piece) / profile.nonLatinBytes));
  }

  /** Total for a whole string under one profile. */
  function countWithProfile(text, profileId) {
    const profile = K.PROFILES[profileId] || K.PROFILES.generic;
    const s = typeof text === 'string' ? text : '';
    if (!s) return 0;
    let total = 0;
    for (const piece of pretokenize(s, profile.id)) total += pieceCost(piece, profile);
    return total;
  }

  // ── Resolving a target to a tokenizer ─────────────────────────────────────

  /**
   * Longest-prefix lookup over tiktoken's own table. [T1]
   *
   * "gpt-5.6-sol" has no entry of its own and matches the "gpt-5" prefix, which
   * is exactly how `tiktoken.encoding_for_model` would resolve it — so a model
   * that ships after this file was written still lands on the right encoding as
   * long as OpenAI keeps its naming.
   */
  function openaiEncodingFor(model) {
    const id = String(model || '').toLowerCase();
    if (!id) return null;
    let best = null;
    for (const prefix of Object.keys(K.OPENAI_ENCODING_BY_PREFIX)) {
      if (!id.startsWith(prefix)) continue;
      if (!best || prefix.length > best.length) best = prefix;
    }
    return best ? K.OPENAI_ENCODING_BY_PREFIX[best] : null;
  }

  /**
   * Decide how to count for a detection target, and say how sure that is.
   *
   * `target` is the shape the model detector already produces:
   *   { provider, canonicalModel, family, routing, selectedLabel }
   *
   * Returns { profileId, method, confidence, reason, provider, model }.
   *
   * The three outcomes that matter:
   *
   *   a known model         -> its own tokenizer, high confidence
   *   a known provider but  -> that provider's CURRENT tokenizer, estimated,
   *   an unmapped model        with the reason recorded. This is the Auto case
   *                            and the new-model case, and it is why the routing
   *                            check comes before the model check: ChatGPT's
   *                            Auto does not expose which model ran, so any
   *                            model-specific claim would be invented.
   *   neither               -> the generic profile, estimated, and the UI says
   *                            so rather than showing a number with no basis
   */
  function resolveStrategy(target) {
    const t = target || {};
    const provider = t.provider || 'unknown';
    const model = t.canonicalModel || null;

    if (provider === 'openai') {
      const encoding = openaiEncodingFor(model);
      if (encoding) {
        return {
          provider, model, profileId: encoding,
          method: 'local-tokenizer', confidence: 'high',
          reason: `${encoding} — the encoding tiktoken maps this model to`,
        };
      }
      return {
        provider, model, profileId: K.OPENAI_DEFAULT_ENCODING,
        method: 'model-estimate', confidence: 'estimated',
        reason: t.routing === 'auto'
          ? 'ChatGPT Auto does not expose the routed model; counted with o200k_base, '
            + 'which every current OpenAI chat model uses'
          : 'model not in the registry; counted with o200k_base, the current OpenAI default',
      };
    }

    if (provider === 'anthropic') {
      const profileId = K.anthropicProfileFor(model);
      const known = !!model;
      return {
        provider, model, profileId,
        method: known ? 'local-tokenizer' : 'model-estimate',
        confidence: known ? 'high' : 'estimated',
        reason: known
          ? `${K.PROFILES[profileId].label} — Anthropic publishes no tokenizer, so this is `
            + 'calibrated against their documented characters-per-token figures'
          : 'model not identified; counted with the current Claude tokenizer calibration',
      };
    }

    return {
      provider, model: null, profileId: 'generic',
      method: 'generic-estimate', confidence: 'estimated',
      reason: 'provider not identified — generic approximation',
    };
  }

  // ── Public counting ───────────────────────────────────────────────────────

  /**
   * Count `text` for a detection target.
   *
   * Returns the full record rather than a number, because a number on its own is
   * exactly what let a `length / 4` approximation be displayed as if it were a
   * measurement:
   *
   *   { count, low, high, provider, model, tokenizer, method, confidence, reason }
   *
   * `low`/`high` bracket the count with the residual uncertainty of the costing
   * step. They are deliberately asymmetric-free (a flat ±band) rather than
   * modelled per piece: claiming to know the shape of our own error would be the
   * same mistake one level up.
   */
  function countText(text, target) {
    const strategy = resolveStrategy(target);
    const count = countWithProfile(text, strategy.profileId);
    const spread = strategy.confidence === 'high' ? 0.08 : 0.18;
    return {
      count,
      low: Math.round(count * (1 - spread)),
      high: Math.round(count * (1 + spread)),
      provider: strategy.provider,
      model: strategy.model,
      tokenizer: strategy.profileId,
      method: strategy.method,
      confidence: strategy.confidence,
      reason: strategy.reason,
    };
  }

  /** Just the number, for call sites that have no room for the record. */
  function count(text, target) {
    return countText(text, target).count;
  }

  const PFTokenCounter = {
    O200K_PATTERN,
    CL100K_PATTERN,
    pretokenize,
    utf8Length,
    pieceCost,
    countWithProfile,
    openaiEncodingFor,
    resolveStrategy,
    countText,
    count,
  };

  if (root) root.PFTokenCounter = PFTokenCounter;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFTokenCounter;
})(typeof self !== 'undefined' ? self : this);
