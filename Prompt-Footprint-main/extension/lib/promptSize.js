// PromptFootprint prompt-size indicator.
//
// Compares the prompt the user is writing against THEIR OWN average prompt size
// (not a fixed global threshold). The goal is a gentle, useful nudge — "this one
// is much bigger than your usual, so it may use more energy" — never a scold.
//
// When there isn't enough personal history yet, it falls back to neutral global
// size bands so the message is still meaningful on day one.
//
// Pure and dependency-free; runs as a content-script/popup global and under Node.

(function (root) {
  'use strict';

  // Below this, a prompt is too short to say anything useful about.
  const MIN_MEANINGFUL_TOKENS = 15;
  // Personal comparison needs at least this many past prompts to be fair.
  const DEFAULT_MIN_SAMPLES = 5;
  // "Much larger" = at least this multiple of the personal average.
  const LARGE_RATIO = 2;

  // Neutral global bands (tokens) used before there's personal history.
  // Anchored loosely to the model's ~50-token average prompt.
  const GLOBAL_BANDS = [
    { max: 60, level: 'short', label: 'a short prompt' },
    { max: 250, level: 'typical', label: 'an average-length prompt' },
    { max: Infinity, level: 'long', label: 'a long prompt' },
  ];

  function round(n) { return Math.round(n); }

  // classifyPromptSize(currentTokens, opts) -> {
  //   hasHistory, avgPromptTokens, level, message
  // }
  //   level: 'neutral' | 'short' | 'typical' | 'long' | 'large'
  //   message: helpful sentence or '' when there's nothing worth saying.
  function classifyPromptSize(currentTokens, opts) {
    const o = opts || {};
    const cur = typeof currentTokens === 'number' && currentTokens > 0 ? currentTokens : 0;
    const avg = typeof o.avgPromptTokens === 'number' ? o.avgPromptTokens : 0;
    const samples = typeof o.sampleCount === 'number' ? o.sampleCount : 0;
    const minSamples = o.minSamples != null ? o.minSamples : DEFAULT_MIN_SAMPLES;
    const hasHistory = samples >= minSamples && avg > 0;

    if (cur < MIN_MEANINGFUL_TOKENS) {
      return { hasHistory, avgPromptTokens: round(avg), level: 'neutral', message: '' };
    }

    if (!hasHistory) {
      // Fall back to neutral global bands.
      const band = GLOBAL_BANDS.find((b) => cur <= b.max);
      const message = band.level === 'long'
        ? 'This is a long prompt, which may use more energy. Trimming filler can help.'
        : '';
      return { hasHistory: false, avgPromptTokens: round(avg), level: band.level, message };
    }

    const ratio = cur / avg;
    if (ratio >= LARGE_RATIO) {
      return {
        hasHistory: true,
        avgPromptTokens: round(avg),
        level: 'large',
        message: 'This prompt is much larger than your average and may use more energy.',
      };
    }
    // Smaller-than-usual or about-usual: no nag, just a neutral classification.
    return {
      hasHistory: true,
      avgPromptTokens: round(avg),
      level: ratio <= 0.6 ? 'short' : 'typical',
      message: '',
    };
  }

  // Short label for a stat line, e.g. "Your average prompt: 420 tokens".
  function averageLabel(avgPromptTokens, sampleCount, minSamples) {
    const min = minSamples != null ? minSamples : DEFAULT_MIN_SAMPLES;
    if (!avgPromptTokens || (sampleCount || 0) < min) {
      return 'Your average prompt: not enough history yet';
    }
    return `Your average prompt: ${round(avgPromptTokens)} tokens`;
  }

  const PFPromptSize = {
    MIN_MEANINGFUL_TOKENS,
    DEFAULT_MIN_SAMPLES,
    LARGE_RATIO,
    classifyPromptSize,
    averageLabel,
  };

  if (root) root.PFPromptSize = PFPromptSize;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFPromptSize;
})(typeof self !== 'undefined' ? self : this);
