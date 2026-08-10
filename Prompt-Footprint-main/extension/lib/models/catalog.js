// PromptFootprint Canonical Model Catalog (versioned)
// ---------------------------------------------------------------------------
// Maps what a user SEES in a model picker onto a canonical model id — and,
// crucially, refuses to map anything it does not recognise.
//
// This is a data table, not a chain of if/else. Providers rename, re-tier, and
// A/B their pickers constantly; when a label we have never seen appears, the
// right answer is `null` plus the raw label preserved, so the UI can say
// "Unknown model" and the estimator can fall back to a provider-level range.
// Silently resolving an unknown label to the current flagship would be the worst
// possible failure: confidently wrong, and invisible.
//
// Labels are also not always models. Auto/Instant/Thinking/Pro are routing or
// effort MODES, and Projects, Gems, custom GPTs, and styles are configurations.
// Each of those is recognised as what it is and never collapsed into a model id.

(function (root) {
  'use strict';

  const CATALOG = {
    schemaVersion: 1,
    updatedAt: '2026-08-06',
    providers: {
      openai: {
        // label alias (normalized) -> canonical id
        aliases: {
          'gpt-5.6': 'gpt-5.6-sol',
          'gpt 5.6': 'gpt-5.6-sol',
          'gpt-5.6 sol': 'gpt-5.6-sol',
          'gpt5.6 sol': 'gpt-5.6-sol',
          sol: 'gpt-5.6-sol',
          'gpt-5.6 terra': 'gpt-5.6-terra',
          terra: 'gpt-5.6-terra',
          'gpt-5.6 luna': 'gpt-5.6-luna',
          luna: 'gpt-5.6-luna',
        },
        models: {
          'gpt-5.6-sol': { label: 'GPT-5.6 Sol', family: 'gpt-5.6', tier: 'flagship', contextTokens: 1050000, maxOutputTokens: 128000, reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], sourceIds: ['S13', 'S14'] },
          'gpt-5.6-terra': { label: 'GPT-5.6 Terra', family: 'gpt-5.6', tier: 'balanced', reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], sourceIds: ['S13'] },
          'gpt-5.6-luna': { label: 'GPT-5.6 Luna', family: 'gpt-5.6', tier: 'efficient', reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], sourceIds: ['S13'] },
        },
        // Product-picker labels that describe HOW a request is handled, not WHICH
        // model handles it. ChatGPT's picker is selected intent; the backend
        // identity is not guaranteed. [S15][S16]
        modes: {
          auto: { routing: 'auto', reasoning: 'unknown' },
          instant: { routing: 'unknown', reasoning: 'none' },
          thinking: { routing: 'unknown', reasoning: 'high' },
          'thinking mini': { routing: 'unknown', reasoning: 'low' },
          pro: { routing: 'unknown', reasoning: 'pro' },
        },
      },
      anthropic: {
        aliases: {
          'sonnet 5': 'claude-sonnet-5',
          'claude sonnet 5': 'claude-sonnet-5',
          'opus 5': 'claude-opus-5',
          'claude opus 5': 'claude-opus-5',
          'fable 5': 'claude-fable-5',
          'claude fable 5': 'claude-fable-5',
          'mythos 5': 'claude-mythos-5',
          'claude mythos 5': 'claude-mythos-5',
        },
        models: {
          'claude-sonnet-5': { label: 'Claude Sonnet 5', family: 'claude-5', tier: 'balanced', maxOutputTokens: 128000, thinking: 'supported-default', sourceIds: ['S7', 'S8', 'S12'] },
          'claude-opus-5': { label: 'Claude Opus 5', family: 'claude-5', tier: 'advanced', contextTokens: 1000000, maxOutputTokens: 128000, thinking: 'on-by-default', thinkingLockedAt: ['xhigh', 'max'], effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], sourceIds: ['S7', 'S10'] },
          'claude-fable-5': { label: 'Claude Fable 5', family: 'claude-5', tier: 'frontier', contextTokens: 1000000, maxOutputTokens: 128000, thinking: 'always-on-adaptive', effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], sourceIds: ['S7', 'S9', 'S10'] },
          'claude-mythos-5': { label: 'Claude Mythos 5', family: 'claude-5', tier: 'restricted-frontier', contextTokens: 1000000, maxOutputTokens: 128000, thinking: 'always-on-adaptive', sourceIds: ['S9'] },
        },
        modes: {
          'adaptive thinking': { routing: 'fixed', reasoning: 'adaptive' },
          'extended thinking': { routing: 'fixed', reasoning: 'high' },
        },
      },
      google: {
        aliases: {
          'gemini 3.1 pro': 'gemini-3.1-pro',
          '3.1 pro': 'gemini-3.1-pro',
          'gemini pro': 'gemini-3.1-pro',
          'deep think': 'gemini-3.1-deep-think',
          'gemini 3.1 deep think': 'gemini-3.1-deep-think',
          'gemini 3.6 flash': 'gemini-3.6-flash',
          '3.6 flash': 'gemini-3.6-flash',
        },
        models: {
          'gemini-3.1-pro': { label: 'Gemini 3.1 Pro', family: 'gemini-3.1', tier: 'flagship', contextTokens: 1000000, maxOutputTokens: 64000, sourceIds: ['S17'] },
          'gemini-3.1-deep-think': { label: 'Gemini 3.1 Deep Think', family: 'gemini-3.1', tier: 'reasoning-mode', builtOn: 'gemini-3.1-pro', sourceIds: ['S18'] },
          // 3.6 > 3.1 numerically, but Flash is the EFFICIENT tier — a higher
          // version number is not evidence of higher per-inference compute.
          'gemini-3.6-flash': { label: 'Gemini 3.6 Flash', family: 'gemini-3.6', tier: 'efficient', sourceIds: ['S19'] },
        },
        modes: {
          fast: { routing: 'fixed', reasoning: 'none' },
          thinking: { routing: 'fixed', reasoning: 'high' },
          'deep think': { routing: 'fixed', reasoning: 'deep-think' },
        },
      },
    },
  };

  // Effort / reasoning words that can appear next to any provider's model label.
  const EFFORT_LABELS = {
    none: 'none', minimal: 'none', off: 'none',
    low: 'low', medium: 'medium', standard: 'medium',
    high: 'high', xhigh: 'xhigh', 'extra high': 'xhigh', max: 'max', maximum: 'max',
    adaptive: 'adaptive', 'adaptive thinking': 'adaptive',
  };

  // Surfaces whose NAME is user-chosen and therefore says nothing about the
  // model behind it. Detected so the UI can label the surface honestly, never so
  // a name can be turned into a model id.
  const NON_MODEL_SURFACES = ['project', 'gem', 'custom-gpt', 'style'];

  /**
   * Normalize a visible label for matching.
   *
   * Lowercases, folds compatibility forms, unifies the five Unicode dashes that
   * providers use interchangeably, and drops trademark marks and decoration.
   * It deliberately does NOT touch digits, dots, or tier words — those are the
   * difference between Sonnet 5 and Opus 5, and between 3.1 Pro and 3.6 Flash.
   */
  function normalizeLabel(raw) {
    if (raw == null) return '';
    let s = String(raw);
    try { s = s.normalize('NFKC'); } catch (_) { /* older engines: skip folding */ }
    return s
      .toLowerCase()
      .replace(/[‐-―−]/g, '-')     // hyphens, dashes, minus
      .replace(/[‘’“”]/g, "'") // smart quotes
      .replace(/[™®©℠]/g, '')
      .replace(/[▾▼⌄↓]/g, '')  // dropdown carets
      .replace(/[^\w\s.+-]/g, ' ')                 // other decoration -> space
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRx(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Aliases longest-first, so "gemini 3.1 deep think" wins over "deep think". */
  function sortedAliases(provider) {
    const p = CATALOG.providers[provider];
    if (!p) return [];
    return Object.keys(p.aliases).sort((a, b) => b.length - a.length);
  }

  function tokenMatch(haystack, needle) {
    const rx = new RegExp(`(?:^|[^a-z0-9])${escapeRx(needle)}(?![a-z0-9])`);
    return rx.test(haystack);
  }

  /**
   * Resolve a visible label to a canonical model.
   *
   * Returns null for anything unrecognised — including Project, Gem, custom-GPT,
   * and style names — rather than guessing. `matchedAlias` is kept so the UI can
   * explain WHY a label resolved the way it did.
   */
  function canonicalize(provider, rawLabel) {
    const p = CATALOG.providers[provider];
    const norm = normalizeLabel(rawLabel);
    if (!p || !norm) return null;

    let alias = p.aliases[norm] ? norm : null;
    if (!alias) alias = sortedAliases(provider).find((a) => tokenMatch(norm, a)) || null;
    if (!alias) return null;

    const id = p.aliases[alias];
    const meta = p.models[id];

    // A bare tier word ("Sol", "Flash", "Pro") is only a safe alias for as long
    // as there is one generation of it. The moment "GPT-5.7 Sol" ships, matching
    // it on "sol" would resolve a brand-new model to last version's entry —
    // confidently, silently, and with that model's energy prior attached.
    //
    // So a label that states a version must agree with the family it resolved
    // to. When it does not, the answer is null: the label is preserved as an
    // unmapped selection and the estimate falls back to the provider level,
    // which is the honest handling of a model we have never seen.
    if (meta && meta.family) {
      const stated = /\d+(?:\.\d+)?/.exec(norm);
      if (stated && !meta.family.includes(stated[0])) return null;
    }

    return {
      canonicalModel: id,
      matchedAlias: alias,
      normalizedLabel: norm,
      family: meta ? meta.family : null,
      tier: meta ? meta.tier : null,
      displayLabel: meta ? meta.label : null,
      sourceIds: meta ? meta.sourceIds : [],
    };
  }

  /** Routing/effort information carried by a picker label, if any. */
  function readMode(provider, rawLabel) {
    const p = CATALOG.providers[provider];
    const norm = normalizeLabel(rawLabel);
    if (!norm) return null;
    const modes = (p && p.modes) || {};
    const key = Object.keys(modes).sort((a, b) => b.length - a.length).find((m) => tokenMatch(norm, m));
    if (key) return { ...modes[key], matched: key };
    const effortKey = Object.keys(EFFORT_LABELS).sort((a, b) => b.length - a.length)
      .find((e) => tokenMatch(norm, e));
    if (effortKey) return { routing: 'fixed', reasoning: EFFORT_LABELS[effortKey], matched: effortKey };
    return null;
  }

  function modelMeta(provider, canonicalModel) {
    const p = CATALOG.providers[provider];
    if (!p || !canonicalModel) return null;
    return p.models[canonicalModel] || null;
  }

  /** Every canonical id in the catalog, for tests and diagnostics. */
  function allModels() {
    return Object.keys(CATALOG.providers).flatMap((prov) =>
      Object.keys(CATALOG.providers[prov].models).map((id) => ({ provider: prov, id, ...CATALOG.providers[prov].models[id] })));
  }

  /**
   * Documented model behaviour that the UI must respect regardless of what the
   * picker shows: Fable 5's adaptive thinking is always on and cannot be turned
   * off, and Opus 5's thinking is on by default and cannot be disabled at xhigh
   * or max. Applied to an observation so the estimate cannot claim a model is
   * running without thinking when the vendor says that is impossible. [S10]
   */
  function applyModelConstraints(observation) {
    const obs = { ...(observation || {}) };
    const model = obs.canonicalModel;
    if (!model) return obs;
    const meta = modelMeta(obs.provider, model);
    if (!meta) return obs;
    if (meta.thinking === 'always-on-adaptive') {
      if (!obs.reasoningMode || obs.reasoningMode === 'none' || obs.reasoningMode === 'unknown') {
        obs.reasoningMode = 'adaptive';
        obs.reasoningLockedBy = 'model';
      }
    } else if (meta.thinking === 'on-by-default') {
      if (!obs.reasoningMode || obs.reasoningMode === 'unknown') {
        obs.reasoningMode = 'adaptive';
      } else if (obs.reasoningMode === 'none') {
        obs.reasoningMode = 'adaptive';
        obs.reasoningLockedBy = 'model-default';
      }
      if ((meta.thinkingLockedAt || []).includes(obs.reasoningMode)) {
        obs.reasoningLockedBy = 'model';
      }
    }
    return obs;
  }

  const PFModelCatalog = {
    CATALOG,
    EFFORT_LABELS,
    NON_MODEL_SURFACES,
    normalizeLabel,
    canonicalize,
    readMode,
    modelMeta,
    allModels,
    applyModelConstraints,
    schemaVersion: CATALOG.schemaVersion,
    updatedAt: CATALOG.updatedAt,
  };

  if (root) root.PFModelCatalog = PFModelCatalog;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFModelCatalog;
})(typeof self !== 'undefined' ? self : this);
