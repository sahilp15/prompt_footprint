// PromptFootprint Prompt Optimizer
// ---------------------------------------------------------------------------
// Local, rule-based prompt compression. Runs entirely in the browser — no
// network call, no LLM, nothing leaves the device — consistent with the
// product's privacy stance.
//
// The goal is CONSERVATIVE compression: strip politeness padding, filler, and
// verbose phrasings that do not change the instruction's meaning, then report
// the estimated token and resource savings so the user can decide before
// sending. We never paraphrase content words or drop sentences, so meaning is
// preserved; suggestions are necessarily lighter-weight than an LLM rewrite.
//
// Runs as a content-script global and under Node for tests.

(function (root) {
  'use strict';

  const _T = (typeof estimateTokens !== 'undefined')
    ? { estimateTokens }
    : require('./tokenEstimator.js');
  const _M = (typeof calculateImpact !== 'undefined')
    ? { calculateImpact }
    : require('./environmentalModel.js');

  // Phrase-level substitutions: wordy -> concise. Case-insensitive, applied
  // with word boundaries. Order matters (longer phrases first).
  const PHRASE_REPLACEMENTS = [
    [/\bdue to the fact that\b/gi, 'because'],
    [/\bin order to\b/gi, 'to'],
    [/\bin the event that\b/gi, 'if'],
    [/\bat this point in time\b/gi, 'now'],
    [/\bat the present time\b/gi, 'now'],
    [/\ba large number of\b/gi, 'many'],
    [/\ba small number of\b/gi, 'a few'],
    [/\bthe majority of\b/gi, 'most'],
    [/\bin spite of the fact that\b/gi, 'although'],
    [/\bwith regard to\b/gi, 'about'],
    [/\bwith reference to\b/gi, 'about'],
    [/\bfor the purpose of\b/gi, 'for'],
    [/\bin the process of\b/gi, ''],
    [/\bit is important to note that\b/gi, ''],
    [/\bplease note that\b/gi, ''],
    [/\bas a matter of fact\b/gi, ''],
    [/\bneedless to say\b/gi, ''],
  ];

  // Politeness / filler phrases that can be removed wholesale.
  const FILLER_PHRASES = [
    /\bcould you please\b/gi,
    /\bcan you please\b/gi,
    /\bcould you kindly\b/gi,
    /\bwould you please\b/gi,
    /\bi was wondering if you could\b/gi,
    /\bi would like you to\b/gi,
    /\bi would like to ask you to\b/gi,
    /\bif it'?s not too much trouble\b/gi,
    /\bif you don'?t mind\b/gi,
    // "thank(s) ... in advance" (any wording in between)
    /\b(?:thank you|thanks)[^.!?\n]{0,25}in advance\b/gi,
    /\bthanks in advance\b/gi,
    /\bthank you so much\b/gi,
    /\bthank you\b/gi,
    /\bmany thanks\b/gi,
    /\bplease\b/gi,
    /\bkindly\b/gi,
  ];

  // Leading greetings are pure filler in a prompt (removed only at the start).
  const LEADING_GREETING = /^(?:hi|hey|hello|greetings|good (?:morning|afternoon|evening))\b[\s,!.]*/i;

  // Low-value intensifiers/hedges (removed only as standalone words).
  const FILLER_WORDS = [
    /\bbasically\b/gi,
    /\bactually\b/gi,
    /\bessentially\b/gi,
    /\bjust\b/gi,
    /\breally\b/gi,
    /\bvery\b/gi,
    /\bquite\b/gi,
    /\bsimply\b/gi,
  ];

  function normalizeWhitespace(text) {
    return text
      .replace(/[ \t]+/g, ' ')          // collapse runs of spaces/tabs
      .replace(/ ?\n ?/g, '\n')          // trim spaces around newlines
      .replace(/\n{3,}/g, '\n\n')        // cap blank-line runs
      .replace(/\s+([,.;:!?])/g, '$1')   // no space before punctuation
      .replace(/([,.;:!?]){2,}/g, '$1')  // de-dupe punctuation
      .replace(/^[\s,;:.!?]+/, '')        // drop leading punctuation/space
      .trim();
  }

  // Produce a shortened version of the prompt.
  function shorten(text) {
    if (!text || typeof text !== 'string') return '';
    let out = text.replace(LEADING_GREETING, '');
    for (const rx of FILLER_PHRASES) out = out.replace(rx, ' ');
    for (const [rx, rep] of PHRASE_REPLACEMENTS) out = out.replace(rx, rep);
    for (const rx of FILLER_WORDS) out = out.replace(rx, ' ');
    out = normalizeWhitespace(out);
    // Re-capitalize a leading lowercased word if we stripped a polite lead-in.
    out = out.replace(/^([a-z])/, (m) => m.toUpperCase());
    return out;
  }

  // Analyze a prompt and return savings. `platform` selects the intensity
  // profile used for the resource-savings estimate (prompt-side tokens).
  function analyze(text, platform) {
    const original = (text || '').toString();
    const shortened = shorten(original);

    const originalTokens = _T.estimateTokens(original);
    const newTokens = _T.estimateTokens(shortened);
    const savedTokens = Math.max(0, originalTokens - newTokens);

    const savings = _M.calculateImpact(savedTokens, { platform: platform || 'chatgpt' });

    return {
      original,
      shortened,
      changed: shortened !== original.trim() && savedTokens > 0,
      originalTokens,
      newTokens,
      savedTokens,
      savedPct: originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 100) : 0,
      savedEnergyWh: savings.energyWh,
      savedWaterMl: savings.waterMl,
      savedCo2G: savings.co2G,
    };
  }

  const PFPromptOptimizer = { shorten, analyze, normalizeWhitespace };

  if (root) root.PFPromptOptimizer = PFPromptOptimizer;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFPromptOptimizer;
})(typeof self !== 'undefined' ? self : this);
