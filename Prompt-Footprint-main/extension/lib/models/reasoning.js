// PromptFootprint — reasoning / thinking normalization
// ---------------------------------------------------------------------------
// Every product spells the same idea differently. ChatGPT offers Instant,
// Thinking, Extended thinking and Pro; Claude offers Low/Medium/High/xHigh/Max
// plus adaptive thinking that cannot be switched off; Gemini has Fast, Thinking
// and Deep Think. Some of those are effort levels, some are modes, and one of
// them (Auto) is a refusal to say.
//
// Two vocabularies are kept, deliberately, and never merged:
//
//   RAW LABEL          exactly what the product showed. Displayed, never
//                      interpreted, never invented. If the picker said
//                      "Extended thinking", that is what the debug panel shows.
//
//   REASONING CLASS    the normalized bucket the ESTIMATOR reasons about:
//                      minimal · standard · adaptive · high · maximum · pro.
//
// The estimator's own `reasoningMode` vocabulary (none/low/medium/high/xhigh/
// max/adaptive/pro/deep-think) is a third thing, and it stays exactly as it was:
// it is wired into published energy priors, and renaming it to match a product
// label would silently re-point those priors. `classify()` maps into the class
// vocabulary; `estimatorMode()` maps back out. Nothing else translates.
//
// The one rule that matters more than any mapping: an unrecognised label
// produces `null`, not a guess. "Not exposed" is a true statement about the page
// and "standard" is a fabrication about the backend.

(function (root) {
  'use strict';

  /**
   * The normalized classes. Ordered from least to most test-time compute, except
   * `adaptive`, which is the product declining to commit — it sits outside the
   * order and is never compared as if it were a level.
   */
  const CLASSES = ['minimal', 'standard', 'adaptive', 'high', 'maximum', 'pro'];

  /** Estimator vocabulary -> reasoning class. */
  const MODE_TO_CLASS = {
    none: 'minimal',
    minimal: 'minimal',
    low: 'standard',
    medium: 'standard',
    standard: 'standard',
    adaptive: 'adaptive',
    auto: 'adaptive',
    high: 'high',
    xhigh: 'maximum',
    max: 'maximum',
    maximum: 'maximum',
    pro: 'pro',
    'deep-think': 'pro',
  };

  /**
   * Reasoning class -> estimator vocabulary.
   *
   * Lossy on purpose and in the safe direction: `maximum` maps back to `max`
   * rather than `xhigh` so a round trip can never quietly reduce the assumed
   * compute of an interaction.
   */
  const CLASS_TO_MODE = {
    minimal: 'none',
    standard: 'medium',
    adaptive: 'adaptive',
    high: 'high',
    maximum: 'max',
    pro: 'pro',
  };

  /**
   * Visible label -> estimator mode.
   *
   * Longest key first at match time, so "extended thinking" is never read as
   * "thinking" and "thinking mini" is never read as "thinking".
   */
  const LABEL_TO_MODE = {
    // Off / fast paths
    instant: 'none',
    fast: 'none',
    off: 'none',
    none: 'none',
    minimal: 'none',
    'no thinking': 'none',
    'thinking off': 'none',
    // Explicit effort levels
    low: 'low',
    light: 'low',
    'thinking mini': 'low',
    'thinking light': 'low',
    medium: 'medium',
    standard: 'medium',
    balanced: 'medium',
    high: 'high',
    heavy: 'high',
    thinking: 'high',
    'extended thinking': 'high',
    'think harder': 'high',
    'think longer': 'high',
    xhigh: 'xhigh',
    'x-high': 'xhigh',
    'extra high': 'xhigh',
    'ultra think': 'xhigh',
    max: 'max',
    maximum: 'max',
    'max thinking': 'max',
    // Product tiers that are their own regime
    pro: 'pro',
    'pro mode': 'pro',
    'deep think': 'deep-think',
    'deep research': 'deep-think',
    // Explicitly undetermined
    auto: 'adaptive',
    automatic: 'adaptive',
    adaptive: 'adaptive',
    'adaptive thinking': 'adaptive',
    'auto thinking': 'adaptive',
  };

  const SORTED_LABELS = Object.keys(LABEL_TO_MODE).sort((a, b) => b.length - a.length);

  function normalize(raw) {
    if (raw == null) return '';
    let s = String(raw);
    try { s = s.normalize('NFKC'); } catch (_) { /* older engines: skip folding */ }
    return s
      .toLowerCase()
      .replace(/[‐-―−]/g, '-')
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Whole-token containment, so "highlight" never matches "high". */
  function tokenMatch(haystack, needle) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`).test(haystack);
  }

  /**
   * Read an estimator reasoning mode out of a visible control label.
   *
   * Returns null when nothing in the label describes reasoning — which includes
   * the very common case of a label that is purely a model name.
   */
  function readModeLabel(rawLabel) {
    const norm = normalize(rawLabel);
    if (!norm) return null;
    const hit = SORTED_LABELS.find((label) => tokenMatch(norm, label));
    return hit ? LABEL_TO_MODE[hit] : null;
  }

  /** Estimator mode (or a class, or a raw label) -> reasoning class, or null. */
  function classify(value) {
    if (!value) return null;
    const key = normalize(value);
    if (!key || key === 'unknown') return null;
    if (MODE_TO_CLASS[key]) return MODE_TO_CLASS[key];
    const mode = readModeLabel(key);
    return mode ? MODE_TO_CLASS[mode] || null : null;
  }

  /** Reasoning class -> estimator mode, or null. */
  function estimatorMode(reasoningClass) {
    return CLASS_TO_MODE[reasoningClass] || null;
  }

  /**
   * Split a control label into the part that names a mode and the part that
   * names an effort level, when a product exposes both in one string
   * ("Thinking · High"). Either half may be null.
   */
  function splitLabel(rawLabel) {
    const raw = String(rawLabel == null ? '' : rawLabel).trim();
    if (!raw) return { modeLabel: null, effortLabel: null };
    const parts = raw.split(/\s*[·|,/–—-]\s*|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    let modeLabel = null;
    let effortLabel = null;
    for (const part of parts.length > 1 ? parts : [raw]) {
      const mode = readModeLabel(part);
      if (!mode) continue;
      // "Thinking" and "Instant" name a MODE; "High" and "Max" name an EFFORT.
      // A product that shows only one of them gets only one of them recorded.
      if (/\b(?:thinking|instant|fast|pro|deep think|auto|adaptive|research)\b/i.test(part)) {
        if (!modeLabel) modeLabel = part;
      } else if (!effortLabel) {
        effortLabel = part;
      }
    }
    if (!modeLabel && !effortLabel && readModeLabel(raw)) effortLabel = raw;
    return { modeLabel, effortLabel };
  }

  /**
   * The reasoning half of a DetectedModel, built from whatever the page exposed.
   *
   * `observation` is a model observation; `rawLabel` is the reasoning control's
   * own label when one was found. Nothing here reads prompt text.
   */
  function describe(observation, rawLabel) {
    const obs = observation || {};
    const split = splitLabel(rawLabel);
    const mode = obs.reasoningMode && obs.reasoningMode !== 'unknown' ? obs.reasoningMode : null;
    const reasoningClass = classify(mode) || classify(rawLabel);
    return {
      // Exactly what the product showed, or null. Never synthesized from a class.
      reasoningModeLabel: split.modeLabel,
      reasoningEffortLabel: split.effortLabel,
      reasoningMode: mode,
      reasoningClass,
      lockedBy: obs.reasoningLockedBy || null,
    };
  }

  /** Sentence-case wording for the pill: "High reasoning", "Thinking". */
  function displayLabel(detected) {
    const d = detected || {};
    if (d.reasoningModeLabel && d.reasoningEffortLabel) {
      return `${d.reasoningModeLabel} · ${d.reasoningEffortLabel}`;
    }
    if (d.reasoningModeLabel) return d.reasoningModeLabel;
    if (d.reasoningEffortLabel) return d.reasoningEffortLabel;
    if (!d.reasoningClass) return null;
    const WORD = {
      minimal: 'Minimal reasoning',
      standard: 'Standard reasoning',
      adaptive: 'Adaptive reasoning',
      high: 'High reasoning',
      maximum: 'Maximum reasoning',
      pro: 'Pro reasoning',
    };
    return WORD[d.reasoningClass] || null;
  }

  const PFReasoning = {
    CLASSES,
    MODE_TO_CLASS,
    CLASS_TO_MODE,
    LABEL_TO_MODE,
    normalize,
    readModeLabel,
    classify,
    estimatorMode,
    splitLabel,
    describe,
    displayLabel,
  };

  if (root) root.PFReasoning = PFReasoning;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFReasoning;
})(typeof self !== 'undefined' ? self : this);
