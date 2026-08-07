// PromptFootprint Environmental Profiles (versioned)
// ---------------------------------------------------------------------------
// The evidence base. Every profile declares what it actually is:
//
//   MEASURED          production instrumentation with a disclosed methodology
//   REPORTED          a provider figure published without a reproducible method
//   MODELED           independent estimate from hardware/latency/token assumptions
//   ENGINEERING_PRIOR PromptFootprint's own assumption for a current model that
//                     nobody has measured yet
//
// Nothing here is ever presented as provider telemetry unless its evidence class
// says MEASURED, and no current flagship model has one. Profiles are additive and
// versioned: correcting an estimate means adding a profile and moving the active
// default, never rewriting a stored history.

(function (root) {
  'use strict';

  const _S = (typeof PFEnvSources !== 'undefined') ? PFEnvSources : require('./sources.js');

  const SCHEMA_VERSION = 1;
  const UPDATED_AT = '2026-08-06';
  /** Stamped onto every estimate so a stored result can be traced to this table. */
  const SNAPSHOT_ID = `env-profiles-v${SCHEMA_VERSION}@${UPDATED_AT}`;

  const EVIDENCE = ['MEASURED', 'REPORTED', 'MODELED', 'ENGINEERING_PRIOR'];
  const CONFIDENCE = ['high', 'medium', 'low', 'very-low'];

  // Wide priors are quoted as a low-high band. The geometric mean is the honest
  // centre for a band spanning an order of magnitude (2-25 Wh); an arithmetic
  // midpoint would sit far above the bulk of the distribution.
  function geoMid(low, high) {
    return Math.sqrt(low * high);
  }

  // ── Product-level anchors ────────────────────────────────────────────────
  // Real measurements/statements about a PRODUCT, not about any single model.

  const PRODUCT_ANCHORS = [
    {
      id: 'gemini_apps_median_2025_05',
      provider: 'google',
      surface: 'gemini_apps',
      scenario: 'product-median',
      modelSpecific: false,
      energyWh: { central: 0.24 },
      // Full-stack boundary: active accelerators 0.14 Wh (58%), CPU+DRAM 0.06 Wh
      // (25%), provisioned idle 0.02 Wh (10%), data-center overhead 0.02 Wh (8%).
      // A narrower accelerator-only boundary gives 0.10 Wh, so this figure is
      // 2.4x the narrow one — never compare it with an accelerator-only number.
      energyBreakdownWh: { accelerators: 0.14, cpuDram: 0.06, idle: 0.02, overhead: 0.02 },
      narrowBoundaryWh: 0.10,
      carbon: { value: 0.03, scope: 'market_based_plus_allocated_embodied', method: 'Market-based Scope 2 plus allocated Scope 1/3 and accelerator embodied emissions' },
      water: { value: 0.26, scope: 'datacenter_cooling_and_associated_infrastructure', boundary: 'cooling', method: 'Water consumed cooling machines and associated data-center infrastructure' },
      evidence: 'MEASURED',
      confidence: 'high',
      sourceIds: ['S1'],
      validFrom: '2025-05-01',
      observedPeriod: '2025-05',
      notes: [
        'Median across Gemini Apps text prompts in May 2025 — a product median, not a measurement of Gemini 3.1 Pro, Deep Think, or Gemini 3.6 Flash.',
        'Water covers cooling and associated data-center infrastructure, not a full lifecycle water footprint.',
      ],
    },
    {
      id: 'chatgpt_reported_average_2025_06',
      provider: 'openai',
      surface: 'chatgpt',
      scenario: 'product-median',
      modelSpecific: false,
      energyWh: { central: 0.34 },
      carbon: null,
      // 0.000085 US gal = 0.32176 mL, displayed as ~0.322 mL.
      water: { value: 0.322, scope: 'undisclosed', boundary: 'undisclosed', method: 'Reported figure; boundary not stated' },
      evidence: 'REPORTED',
      confidence: 'low',
      sourceIds: ['S2', 'S3'],
      validFrom: '2025-06-01',
      notes: [
        'No methodology disclosed: model, prompt/output length, reasoning mode, tools, hardware, utilization, PUE, carbon intensity, and water boundary are all unstated.',
        'Must not be applied as a constant to GPT-5.6 Sol Pro/max, deep research, Codex, browsing, computer use, images, multi-agent work, or long responses.',
      ],
    },
  ];

  // ── Independent modelled proxies ─────────────────────────────────────────
  // Historical models on historical hardware. Useful as shape and scale; never
  // as a description of a current model.

  const PROXY_PROFILES = [
    ...[
      ['short', 100, 300, 0.423],
      ['medium', 1000, 1000, 1.215],
      ['long', 10000, 1500, 2.875],
    ].map(([scenario, input, output, wh]) => ({
      id: `gpt4o_azure_proxy_${scenario}`,
      provider: 'openai',
      model: 'gpt-4o',
      surface: 'api_proxy',
      scenario,
      modelSpecific: true,
      tokenAssumptions: { input, output },
      energyWh: { central: wh },
      carbon: { factorId: 'azure_openai_proxy', scope: 'location_based_grid_proxy', method: 'Azure CIF proxy' },
      water: { factorId: 'azure_full_operational', scope: 'onsite_cooling_plus_electricity_generation', boundary: 'full-operational', method: 'Azure PUE/WUE proxy' },
      evidence: 'MODELED',
      confidence: 'medium',
      sourceIds: ['S5'],
      validFrom: '2025-05-01',
      notes: ['Azure-hosted GPT-4o proxy. Not OpenAI telemetry and not a description of GPT-5.6.'],
    })),
    ...[
      ['short', 100, 300, 0.950, 0.040],
      ['medium', 1000, 1000, 2.989, 0.201],
      ['long', 10000, 1500, 5.671, 0.302],
    ].map(([scenario, input, output, wh, sd]) => ({
      id: `claude_3_7_sonnet_aws_proxy_${scenario}`,
      provider: 'anthropic',
      model: 'claude-3.7-sonnet',
      surface: 'api_proxy',
      scenario,
      modelSpecific: true,
      tokenAssumptions: { input, output },
      energyWh: { low: wh - sd, central: wh, high: wh + sd, sd },
      carbon: { factorId: 'aws_anthropic_proxy', scope: 'location_based_grid_proxy', method: 'AWS-weighted CIF proxy' },
      water: { factorId: 'aws_full_operational', scope: 'onsite_cooling_plus_electricity_generation', boundary: 'full-operational', method: 'AWS PUE/WUE proxy' },
      evidence: 'MODELED',
      confidence: 'low',
      sourceIds: ['S5'],
      validFrom: '2025-05-01',
      notes: [
        'Not Anthropic telemetry: a historical Claude 3.7 Sonnet / AWS H100-H200-class proxy at batch size 8.',
        'Not a measurement of Sonnet 5, Opus 5, Fable 5, or Mythos 5.',
      ],
    })),
    // GPT-5 adaptive-routing case study — the anchor behind the high-reasoning bands.
    ...[
      ['short_minimal', 0.67], ['medium_minimal', 2.33],
      ['medium_high', 17.15], ['long_high', 33.8],
    ].map(([mode, wh]) => ({
      id: `gpt5_routing_proxy_${mode}`,
      provider: 'openai',
      model: 'gpt-5',
      surface: 'api_proxy',
      scenario: mode.startsWith('long') ? 'long' : (mode.startsWith('medium') ? 'medium' : 'short'),
      modelSpecific: true,
      energyWh: { central: wh },
      evidence: 'MODELED',
      confidence: 'low',
      sourceIds: ['S5'],
      validFrom: '2025-05-01',
      notes: ['Independent GPT-5 adaptive-routing proxy; reasoning level dominates the result.'],
    })),
  ];

  // ── Generic frontier fallback ────────────────────────────────────────────
  // Used when the product or the model cannot be resolved. Never attributed to
  // any named provider or model.

  const GENERIC_PROFILES = [
    {
      id: 'generic_frontier_2026_ordinary',
      provider: 'unknown',
      scenario: 'short',
      modelSpecific: false,
      tokenAssumptions: { input: 100, output: 300 },
      assumedMedianOutputTokens: 300,
      energyWh: { low: 0.18, central: 0.34, high: 0.67 },
      evidence: 'MODELED',
      confidence: 'medium',
      sourceIds: ['S4'],
      validFrom: '2026-01-01',
      notes: ['Conventional frontier query: 0.34 Wh median, IQR 0.18-0.67, under realistic deployment assumptions.'],
    },
    {
      id: 'generic_frontier_2026_reasoning',
      provider: 'unknown',
      scenario: 'reasoning',
      modelSpecific: false,
      tokenAssumptions: { input: 100, output: 5000 },
      assumedMedianOutputTokens: 5000,
      approximateTokenScaleVsOrdinary: 15,
      approximateEnergyScaleVsOrdinary: 13,
      energyWh: { low: 2.38, central: 4.32, high: 7.38 },
      evidence: 'MODELED',
      confidence: 'medium',
      sourceIds: ['S4'],
      validFrom: '2026-01-01',
      notes: ['Test-time-scaling query: 4.32 Wh median, IQR 2.38-7.38, at roughly 15x the generated tokens of an ordinary query.'],
    },
  ];

  // ── Current-model engineering priors ─────────────────────────────────────
  // No provider publishes model-specific production telemetry for any of these.
  // Every entry is a low-confidence assumption anchored to the verified values
  // above, and is labelled ENGINEERING_PRIOR everywhere it surfaces.

  const SHORT_PRIOR_SPECS = [
    ['gemini-3.6-flash',  'google',    0.15, 0.40, 0.24, 'Gemini Apps product median adapted to the efficient tier', ['S1', 'S19']],
    ['gemini-3.1-pro',    'google',    0.30, 1.00, 0.50, 'Engineering prior above the Gemini Apps product median', ['S1', 'S17']],
    ['gpt-5.6-luna',      'openai',    0.20, 0.60, 0.34, 'ChatGPT reported average plus the generic frontier baseline', ['S2', 'S4', 'S13']],
    ['gpt-5.6-terra',     'openai',    0.30, 0.90, 0.50, 'Engineering prior between the efficient and flagship tiers', ['S4', 'S13']],
    ['gpt-5.6-sol',       'openai',    0.40, 1.20, 0.67, 'GPT-5 short/minimal independent routing proxy', ['S5', 'S13', 'S14']],
    ['claude-sonnet-5',   'anthropic', 0.60, 1.20, 0.90, 'Claude 3.7 Sonnet AWS proxy, widened for an unknown current deployment', ['S5', 'S8']],
    ['claude-opus-5',     'anthropic', 0.80, 2.00, 1.20, 'Engineering prior above Sonnet 5; thinking on by default', ['S5', 'S7', 'S10']],
    ['claude-fable-5',    'anthropic', 1.00, 3.00, 2.00, 'Engineering prior; adaptive thinking is always on and cannot be disabled', ['S7', 'S9', 'S10']],
    // Mythos has no published environmental figure and no separate proxy. It gets
    // its OWN profile, mirroring Fable's band, rather than being aliased to Fable:
    // the two are distinct models and must never collapse into one another.
    ['claude-mythos-5',   'anthropic', 1.00, 3.00, 2.00, 'Engineering prior mirroring the Fable 5 band; Mythos is a distinct model with no separate evidence', ['S9']],
  ];

  const SHORT_PRIORS = SHORT_PRIOR_SPECS.map(([model, provider, low, high, central, basis, sourceIds]) => ({
    id: `prior_${model}_short_2026`,
    provider,
    model,
    scenario: 'short',
    modelSpecific: false,
    modelSpecificMeasurement: false,
    tokenAssumptions: { input: 100, output: 300 },
    energyWh: { low, central, high },
    evidence: 'ENGINEERING_PRIOR',
    confidence: 'low',
    sourceIds,
    validFrom: UPDATED_AT,
    basis,
    notes: [
      'PromptFootprint engineering prior, not a measurement: no provider publishes production telemetry for this model.',
      'Assumes an ordinary short text interaction with no browsing, code execution, images, deep research, computer use, multi-agent orchestration, or extended reasoning.',
    ],
  }));

  // ── High-reasoning / agentic priors ──────────────────────────────────────
  // Deliberately broad. A wide honest band beats a narrow invented one.

  const REASONING_PRIOR_SPECS = [
    ['gemini-3.1-deep-think', 'google',    ['deep-think'],               2.0, 7.0,  5.0, 25.0, ['S1', 'S18']],
    ['gemini-3.1-pro',        'google',    ['high', 'xhigh', 'max'],     1.5, 7.0,  4.0, 20.0, ['S1', 'S17']],
    ['gpt-5.6-sol',           'openai',    ['high', 'xhigh', 'max', 'pro'], 3.0, 18.0, 10.0, 35.0, ['S5', 'S14']],
    ['claude-opus-5',         'anthropic', ['xhigh', 'max'],             3.0, 20.0, 8.0,  35.0, ['S5', 'S10']],
    ['claude-fable-5',        'anthropic', ['high', 'xhigh', 'max'],     4.0, 25.0, 10.0, 40.0, ['S9', 'S10']],
  ];

  const REASONING_PRIORS = REASONING_PRIOR_SPECS.map(
    ([model, provider, modes, medLow, medHigh, longLow, longHigh, sourceIds]) => ({
      id: `prior_${model}_reasoning_2026`,
      provider,
      model,
      modes,
      scenario: 'reasoning',
      modelSpecific: false,
      modelSpecificMeasurement: false,
      // "medium high reasoning" and "long/max reasoning" from the spec's table.
      bands: {
        medium: { low: medLow, central: geoMid(medLow, medHigh), high: medHigh },
        long: { low: longLow, central: geoMid(longLow, longHigh), high: longHigh, openEnded: true },
      },
      energyWh: { low: medLow, central: geoMid(medLow, medHigh), high: longHigh, openEnded: true },
      evidence: 'ENGINEERING_PRIOR',
      confidence: 'low',
      sourceIds,
      validFrom: UPDATED_AT,
      notes: [
        'Broad engineering prior for high-reasoning or agentic work; the upper bound is open-ended because hidden reasoning and tool calls are not observable from the page.',
        'Anchored to the generic test-time-scaling median of 4.32 Wh (IQR 2.38-7.38) and the independent GPT-5 routing proxy (0.67 / 2.33 / 17.15 / 33.8 Wh).',
      ],
    })
  );

  const PROFILES = [].concat(PRODUCT_ANCHORS, PROXY_PROFILES, GENERIC_PROFILES, SHORT_PRIORS, REASONING_PRIORS);
  const BY_ID = Object.fromEntries(PROFILES.map((p) => [p.id, p]));

  // ── Scenario shape ───────────────────────────────────────────────────────
  // Multipliers on the SHORT prior, from the independent GPT-4o and Claude 3.7
  // scenario sets. Not linear in tokens and never extrapolated far past the
  // long scenario's 10k input / 1.5k output.
  const SCENARIO_MULTIPLIERS = {
    short: { low: 1, high: 1 },
    medium: { low: 2.5, high: 3.5 },
    long: { low: 5, high: 7 },
  };

  /** Token bounds the published scenarios actually cover. */
  const SCENARIO_TOKENS = {
    short: { input: 100, output: 300 },
    medium: { input: 1000, output: 1000 },
    long: { input: 10000, output: 1500 },
  };
  const EXTRAPOLATION_LIMIT = { inputTokens: 10000, outputTokens: 1500 };

  /** Conservative input-token share of total interaction energy, by scenario. */
  const INPUT_ENERGY_SHARE = {
    short: { low: 0.01, high: 0.05 },
    medium: { low: 0.05, high: 0.15 },
    long: { low: 0.25, high: 0.50 },
  };

  // ── Lookups ──────────────────────────────────────────────────────────────

  function byId(id) {
    return BY_ID[id] || null;
  }

  /** The ordinary-short prior for a canonical model id, or null if unknown. */
  function shortPriorFor(canonicalModel) {
    if (!canonicalModel) return null;
    return SHORT_PRIORS.find((p) => p.model === canonicalModel) || null;
  }

  /**
   * The high-reasoning prior for a model in a given mode. Returns null when the
   * mode is not one this model's prior covers, so an ordinary-effort request
   * never silently inherits a max-effort band.
   */
  function reasoningPriorFor(canonicalModel, mode) {
    if (!canonicalModel) return null;
    const candidates = REASONING_PRIORS.filter((p) => p.model === canonicalModel);
    if (!candidates.length) return null;
    if (!mode) return null;
    return candidates.find((p) => p.modes.includes(mode)) || null;
  }

  /** Generic frontier fallback: 'ordinary' | 'reasoning'. */
  function genericFallback(kind) {
    return byId(kind === 'reasoning' ? 'generic_frontier_2026_reasoning' : 'generic_frontier_2026_ordinary');
  }

  /** The measured/reported PRODUCT anchor for a surface, if one exists. */
  function productAnchor(provider, surface) {
    return PRODUCT_ANCHORS.find(
      (p) => p.provider === provider && (!surface || p.surface === surface || surface === p.surface)
    ) || PRODUCT_ANCHORS.find((p) => p.provider === provider) || null;
  }

  /** Historical token-fit proxy family for a provider ('openai' | 'anthropic'). */
  function proxyFamily(provider) {
    return provider === 'anthropic' ? 'claude_3_7_aws' : 'gpt_4o_azure';
  }

  const PFEnvProfiles = {
    SCHEMA_VERSION,
    UPDATED_AT,
    SNAPSHOT_ID,
    EVIDENCE,
    CONFIDENCE,
    PROFILES,
    PRODUCT_ANCHORS,
    PROXY_PROFILES,
    GENERIC_PROFILES,
    SHORT_PRIORS,
    REASONING_PRIORS,
    SCENARIO_MULTIPLIERS,
    SCENARIO_TOKENS,
    EXTRAPOLATION_LIMIT,
    INPUT_ENERGY_SHARE,
    byId,
    shortPriorFor,
    reasoningPriorFor,
    genericFallback,
    productAnchor,
    proxyFamily,
    geoMid,
    sources: _S,
  };

  if (root) root.PFEnvProfiles = PFEnvProfiles;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFEnvProfiles;
})(typeof self !== 'undefined' ? self : this);
