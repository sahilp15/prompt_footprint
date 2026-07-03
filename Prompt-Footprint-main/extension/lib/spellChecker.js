// PromptFootprint Spell / Writing Checker (local, offline baseline)
// ---------------------------------------------------------------------------
// The fast, fully-offline tier of the writing assistant. Detects:
//   • misspellings        — curated common typos + Typo.js (Hunspell dict)
//   • capitalization      — sentence starts, the pronoun "I"
//   • punctuation         — double spaces, space-before-punctuation, repeats,
//                           missing terminal punctuation
//   • basic grammar       — a/an, immediately repeated words
//
// Pure and side-effect free: every function takes text (and an optional Typo
// instance) and returns plain data, so it is unit-testable under Node and runs
// unchanged as a content-script global. Network/AI lives elsewhere (background
// IMPROVE_WRITING → Gemini proxy); this module never makes a request.
//
// A suggestion is: { type, original, suggestion, reason, safe }
//   safe === true  → high-confidence, included in "Accept all safe fixes".
//   safe === false → advisory (shown, applied only on explicit Accept).

(function (root) {
  'use strict';

  const _O = (typeof PFPromptOptimizer !== 'undefined')
    ? PFPromptOptimizer
    : require('./promptOptimizer.js');

  // Resolve the Typo constructor (browser global from vendor/typo.js, or npm in
  // Node tests). Returns null if unavailable so callers degrade gracefully.
  function getTypoCtor() {
    if (typeof Typo !== 'undefined') return Typo;
    try { return require('./vendor/typo.js'); } catch (_) { return null; }
  }

  // Build a Typo instance from raw .aff/.dic strings. Returns null on failure so
  // the checker keeps working (curated typos + rules) without a dictionary.
  function createChecker(affData, dicData) {
    const Ctor = getTypoCtor();
    if (!Ctor || !affData || !dicData) return null;
    try { return new Ctor('en_US', affData, dicData); } catch (_) { return null; }
  }

  // ── word iteration ────────────────────────────────────────────────────────
  // Letters plus internal apostrophes (don't, I'm). Indexes preserved so the UI
  // can locate the original token.
  const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)*/g;

  function eachWord(text, fn) {
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(text)) !== null) fn(m[0], m.index);
  }

  // Tech/brand terms the bundled dictionary doesn't recognize. Left unchecked
  // they fall through to Typo.js's nearest-edit-distance suggestion, which can
  // be a real but unrelated word (e.g. "chatgpt" -> "catgut", "readme" ->
  // "rename") — confidently wrong and exactly the kind of corruption "safe"
  // auto-fixes must never produce. Known terms either get their canonical
  // casing (lowercase key -> proper form) or are treated as already correct.
  const KNOWN_WORD_CASING = {
    chatgpt: 'ChatGPT', github: 'GitHub', readme: 'README', gpt: 'GPT',
    claude: 'Claude', anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini',
  };
  const KNOWN_WORDS = new Set([
    ...Object.keys(KNOWN_WORD_CASING),
    'repo', 'repos', 'api', 'apis', 'ui', 'ux', 'json', 'html', 'css', 'url', 'urls',
  ]);

  // Preserve the original token's leading capitalization on a replacement.
  function matchCase(original, replacement) {
    if (original && original[0] === original[0].toUpperCase() &&
        replacement && replacement[0] === replacement[0].toLowerCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  }

  // ── spelling ────────────────────────────────────────────────────────────--
  // Curated common typos first (high confidence, safe), then the dictionary.
  function checkSpelling(text, typo) {
    const out = [];
    const seen = new Set();
    eachWord(text, (word) => {
      if (word.length < 2) return;
      const key = word.toLowerCase();
      if (seen.has(key)) return;

      // 1) Curated map (reuses the optimizer's COMMON_TYPOS via fixTypos).
      const fixed = _O.fixTypos(word).text;
      if (fixed.toLowerCase() !== word.toLowerCase()) {
        seen.add(key);
        out.push({ type: 'spelling', original: word, suggestion: fixed,
          reason: 'Common misspelling', safe: true });
        return;
      }

      // 1.5) Known tech/brand terms — canonical casing, or already correct.
      // Skipped before the dictionary so it can never offer an unrelated
      // nearest-edit-distance word for a term it simply doesn't recognize.
      if (Object.prototype.hasOwnProperty.call(KNOWN_WORD_CASING, key)) {
        const canonical = KNOWN_WORD_CASING[key];
        if (word !== canonical) {
          seen.add(key);
          out.push({ type: 'spelling', original: word, suggestion: canonical,
            reason: 'Known capitalization', safe: true });
        }
        return;
      }
      if (KNOWN_WORDS.has(key)) return;

      // 2) Dictionary check. Skip Capitalized words (likely proper nouns) for
      //    the *safe* flag so we never auto-rename names.
      if (!typo) return;
      if (typo.check(word) || typo.check(key)) return;
      const suggestions = typo.suggest(word) || [];
      if (!suggestions.length) return;
      seen.add(key);
      const isLower = word === key;
      out.push({ type: 'spelling', original: word,
        suggestion: matchCase(word, suggestions[0]),
        reason: 'Possible misspelling', safe: isLower });
    });
    return out;
  }

  // ── capitalization ────────────────────────────────────────────────────────
  const SENTENCE_START_RE = /(^|[.!?]["')\]]?\s+)([a-z])/g;
  const LONE_I_RE = /\bi\b/g; // matches "i" and the i in i'm / i've (apostrophe is a boundary)

  function checkCapitalization(text) {
    const out = [];
    let m;
    SENTENCE_START_RE.lastIndex = 0;
    if ((m = SENTENCE_START_RE.exec(text)) !== null) {
      // Report once; "Accept all safe" fixes every sentence start at apply time.
      out.push({ type: 'capitalization', original: m[2], suggestion: m[2].toUpperCase(),
        reason: 'Capitalize the start of the sentence', safe: true });
    }
    LONE_I_RE.lastIndex = 0;
    if (LONE_I_RE.test(text)) {
      out.push({ type: 'capitalization', original: 'i', suggestion: 'I',
        reason: 'Capitalize the pronoun “I”', safe: true });
    }
    return out;
  }

  // ── punctuation ───────────────────────────────────────────────────────────
  function checkPunctuation(text) {
    const out = [];
    if (/ {2,}/.test(text)) {
      out.push({ type: 'punctuation', original: '  ', suggestion: ' ',
        reason: 'Remove extra spaces', safe: true });
    }
    if (/\s+[,.;:!?]/.test(text)) {
      out.push({ type: 'punctuation', original: ' ,', suggestion: ',',
        reason: 'Remove the space before punctuation', safe: true });
    }
    if (/([,;:!?])\1+/.test(text)) {
      out.push({ type: 'punctuation', original: '!!', suggestion: '!',
        reason: 'Remove repeated punctuation', safe: true });
    }
    // Missing terminal punctuation: prose-like text (>=4 words) not ending in a
    // sentence terminator. Advisory only — prompts often omit it intentionally.
    const trimmed = text.trim();
    if (trimmed && !/[.!?]["')\]]?$/.test(trimmed) &&
        (trimmed.match(WORD_RE) || []).length >= 4) {
      out.push({ type: 'punctuation', original: trimmed.slice(-12), suggestion: trimmed.slice(-12) + '.',
        reason: 'Add a period at the end', safe: false });
    }
    return out;
  }

  // ── grammar ───────────────────────────────────────────────────────────────
  const REPEAT_RE = /\b(\w+)\s+\1\b/i;
  // Conservative a/an: clear vowel/consonant cases only (skips ambiguous u-/h-).
  const A_BEFORE_VOWEL = /\ba\s+([aeio]\w*)/i;
  const AN_BEFORE_CONS = /\ban\s+([bcdfgjklmnpqrstvwxyz]\w*)/i;

  function checkGrammar(text) {
    const out = [];
    let m;
    if ((m = REPEAT_RE.exec(text)) !== null) {
      out.push({ type: 'grammar', original: `${m[1]} ${m[1]}`, suggestion: m[1],
        reason: 'Repeated word', safe: true });
    }
    if ((m = A_BEFORE_VOWEL.exec(text)) !== null) {
      out.push({ type: 'grammar', original: `a ${m[1]}`, suggestion: `an ${m[1]}`,
        reason: 'Use “an” before a vowel sound', safe: false });
    }
    if ((m = AN_BEFORE_CONS.exec(text)) !== null) {
      out.push({ type: 'grammar', original: `an ${m[1]}`, suggestion: `a ${m[1]}`,
        reason: 'Use “a” before a consonant sound', safe: false });
    }
    return out;
  }

  // ── deterministic "accept all safe fixes" ──────────────────────────────────
  // Applies only the high-confidence transforms, in a fixed order, directly on
  // the text (no offset splicing) so the result is always consistent. Operates
  // line-by-line and skips list markers so bullets/numbering survive.
  function capitalizeSentences(s) {
    return s.replace(SENTENCE_START_RE, (mm, pre, ch) => pre + ch.toUpperCase());
  }

  function fixSpellingSafe(line, typo) {
    return line.replace(WORD_RE, (word) => {
      const fixed = _O.fixTypos(word).text;
      if (fixed.toLowerCase() !== word.toLowerCase()) return fixed;
      const key = word.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(KNOWN_WORD_CASING, key)) return KNOWN_WORD_CASING[key];
      if (KNOWN_WORDS.has(key)) return word;
      if (!typo || word.length < 2) return word;
      if (word !== word.toLowerCase()) return word; // leave Capitalized words alone
      if (typo.check(word)) return word;
      const s = typo.suggest(word) || [];
      return s.length ? s[0] : word;
    });
  }

  // Split a line into its leading list/quote marker and the content after it.
  const MARKER_RE = /^(\s*(?:[-*+]\s+|\d+[.)]\s+|>\s+)?)([\s\S]*)$/;
  const REPEAT_RE_G = /\b(\w+)\s+\1\b/gi;

  function applySafeFixesLine(line, typo) {
    const parts = MARKER_RE.exec(line);
    const marker = parts ? parts[1] : '';
    let body = parts ? parts[2] : line;
    body = fixSpellingSafe(body, typo);
    body = body.replace(REPEAT_RE_G, '$1');
    body = body.replace(LONE_I_RE, 'I');
    body = body.replace(/ {2,}/g, ' ').replace(/([ \t]+)([,.;:!?])/g, '$2');
    body = body.replace(/([,;:!?])\1+/g, '$1');
    body = capitalizeSentences(body);
    return marker + body;
  }

  function applySafeFixes(text, typo) {
    return text.split('\n').map((line) => applySafeFixesLine(line, typo)).join('\n');
  }

  // Apply a single suggestion (used by per-suggestion "Accept"). Replaces the
  // first occurrence of the original token; capitalization-only and the generic
  // spacing fixes route through the deterministic path.
  function applyOne(text, sug) {
    if (!sug) return text;
    if (sug.type === 'capitalization' && sug.original === 'i') {
      return text.replace(LONE_I_RE, 'I');
    }
    if (sug.type === 'capitalization') {
      return capitalizeSentences(text);
    }
    if (sug.type === 'punctuation') {
      // Spacing/repeat fixes are global and idempotent.
      return text
        .replace(/ {2,}/g, ' ')
        .replace(/([ \t]+)([,.;:!?])/g, '$2')
        .replace(/([,;:!?])\1+/g, '$1');
    }
    const esc = sug.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replaced = text.replace(new RegExp(`\\b${esc}\\b`), () => matchCase(sug.original, sug.suggestion));
    if (sug.suggestion === '') {
      // Removing a filler word/phrase (suggestion === '') can leave a doubled
      // space, a dangling space before punctuation, or an uncapitalized start
      // (if the removed text opened the sentence) — tidy those up.
      return capitalizeSentences(
        replaced.replace(/ {2,}/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim()
      );
    }
    return replaced;
  }

  // ── top-level analysis ──────────────────────────────────────────────────--
  function analyzeWriting(text, opts) {
    const typo = (opts && opts.typo) || null;
    const raw = (text || '').toString();
    const suggestions = [
      ...checkSpelling(raw, typo),
      ...checkCapitalization(raw),
      ...checkGrammar(raw),
      ...checkPunctuation(raw),
      // Filler/concision suggestions (type: 'filler') are advisory only
      // (safe: false) — kept out of safeFixedText/safeCount so they never
      // get bulk-applied by "Accept all safe"; spelling stays untouched.
      ..._O.detectFiller(raw),
      // Content-level hints (type: 'clarity'): unnecessary repetition and
      // overly long sentences. Also advisory, computed locally (no network).
      ...(typeof _O.detectRedundancy === 'function' ? _O.detectRedundancy(raw) : []),
    ];
    // De-duplicate identical suggestions.
    const seen = new Set();
    const deduped = suggestions.filter((s) => {
      const k = `${s.type}|${s.original}|${s.suggestion}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const safeFixedText = applySafeFixes(raw, typo);
    const safeCount = deduped.filter((s) => s.safe).length;
    return {
      suggestions: deduped,
      safeFixedText,
      safeCount,
      changed: safeFixedText.trim() !== raw.trim() || deduped.length > 0,
    };
  }

  const PFSpellChecker = {
    createChecker,
    checkSpelling,
    checkCapitalization,
    checkPunctuation,
    checkGrammar,
    analyzeWriting,
    applySafeFixes,
    applyOne,
  };

  if (root) root.PFSpellChecker = PFSpellChecker;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFSpellChecker;
})(typeof self !== 'undefined' ? self : this);
