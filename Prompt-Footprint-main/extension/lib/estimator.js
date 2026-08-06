// PromptFootprint Estimator
// ---------------------------------------------------------------------------
// Turns what we can observe about an interaction (provider, selected model,
// reasoning mode, tools, tokens) into a RANGE with its evidence attached.
//
// Three rules shape everything below.
//
//   1. Never a bare scalar. Every result is low/central/high plus the evidence
//      class, confidence, assumptions, and source ids that produced it.
//   2. Never a borrowed identity. A product median is not a model measurement,
//      a 2025 proxy is not a 2026 model, and an unknown model stays unknown —
//      it never falls back to a named flagship.
//   3. Never a merged boundary. Carbon and water carry their accounting scope,
//      and cooling water is a different field from full-operational water.
//
// Energy is assembled per §5.1 of the spec:
//
//   interaction = fixed serving + input prefill + visible output decode
//               + hidden reasoning + model/tool routing overhead
//   task        = sum of the interactions we can actually see, marked as a
//                 lower bound whenever the page hides sub-calls
//
// Runs as a content-script global and under Node for tests.

(function (root) {
  'use strict';

  const _P = (typeof PFEnvProfiles !== 'undefined') ? PFEnvProfiles : require('./env/profiles.js');
  const _F = (typeof PFEnvFactors !== 'undefined') ? PFEnvFactors : require('./env/factors.js');
  const _C = (typeof PFEnvCopy !== 'undefined') ? PFEnvCopy : require('./env/copy.js');
  const _S = (typeof PFEnvSources !== 'undefined') ? PFEnvSources : require('./env/sources.js');

  // ── Classification ───────────────────────────────────────────────────────

  /**
   * Which published scenario shape this interaction resembles. The boundaries sit
   * between the three scenarios the independent research actually measured
   * (100/300, 1k/1k, 10k/1.5k) rather than on round numbers.
   */
  function classifyScenario(inputTokens, outputTokens) {
    const i = Math.max(0, inputTokens || 0);
    const o = Math.max(0, outputTokens || 0);
    if (i <= 400 && o <= 600) return 'short';
    if (i <= 4000 && o <= 2500) return 'medium';
    return 'long';
  }

  /** Reasoning modes that put an interaction in the test-time-scaling regime. */
  const HEAVY_REASONING = ['high', 'xhigh', 'max', 'pro', 'deep-think'];
  /** Tools whose presence means the "one prompt" is really an agentic task. */
  const AGENTIC_TOOLS = ['deep-research', 'research', 'computer-use', 'agent', 'multi-agent', 'codex', 'code-execution'];
  /** Tools that add compute without necessarily changing the regime. */
  const OVERHEAD_TOOLS = ['web-search', 'browsing', 'image', 'video', 'audio', 'canvas', 'artifacts', 'file-search', 'connected-apps'];

  /** 'ordinary' or 'reasoning' — which family of priors applies. */
  function classifyReasoning(reasoning, tools) {
    const list = tools || [];
    if (HEAVY_REASONING.includes(reasoning)) return 'reasoning';
    if (list.some((t) => AGENTIC_TOOLS.includes(t))) return 'reasoning';
    return 'ordinary';
  }

  // ── Token-fit proxies (fallback only) ────────────────────────────────────
  // Least-squares fits PromptFootprint derived from the three published
  // scenarios. They are OURS, not equations the authors published, and they
  // describe GPT-4o on Azure and Claude 3.7 Sonnet on AWS — not GPT-5.6 and not
  // Claude 5. They exist to give a token-sensitive shape inside a prior band,
  // never to replace it.

  const TOKEN_FITS = {
    gpt_4o_azure: { fixed: 0.121, perInput: 0.000131, perOutput: 0.000963, sourceIds: ['S5'], model: 'gpt-4o' },
    claude_3_7_aws: { fixed: 0.118, perInput: 0.000147, perOutput: 0.002724, sourceIds: ['S5'], model: 'claude-3.7-sonnet' },
  };

  /**
   * Which token fit, if any, is defensible for a provider.
   *
   * Google is deliberately absent: no published token-level scenario set exists
   * for Gemini, and borrowing the GPT-4o/Azure fit to fill the gap would put an
   * OpenAI-shaped curve behind a Google number with nothing to back it.
   */
  function proxyFamilyFor(provider) {
    if (provider === 'anthropic') return 'claude_3_7_aws';
    if (provider === 'openai' || provider === 'unknown') return 'gpt_4o_azure';
    return null;
  }

  /**
   * Energy from a token fit, clamped at the limit of the scenarios it was fit to.
   *
   * Beyond 10k input / 1.5k output the fit is extrapolating past every point that
   * produced it, and context caching, attention cost, batching, and utilization
   * all turn nonlinear there. So the inputs are clamped and the UNCERTAINTY is
   * widened sublinearly instead of the estimate being extended in a straight
   * line — a wide honest band rather than a confident wrong number.
   */
  function tokenFitWh(family, inputTokens, outputTokens) {
    const fit = TOKEN_FITS[family] || TOKEN_FITS.gpt_4o_azure;
    const lim = _P.EXTRAPOLATION_LIMIT;
    const i = Math.max(0, inputTokens || 0);
    const o = Math.max(0, outputTokens || 0);
    const ci = Math.min(i, lim.inputTokens);
    const co = Math.min(o, lim.outputTokens);
    const central = fit.fixed + fit.perInput * ci + fit.perOutput * co;

    const excess = Math.max(i / lim.inputTokens, o / lim.outputTokens, 1);
    const clamped = excess > 1;
    // Half the excess ratio, capped at 3x: growth past the fitted range is real
    // but sublinear, and the cap stops a 200k-token context from producing a
    // fantasy number.
    const widen = clamped ? Math.min(3, 1 + 0.5 * (excess - 1)) : 1;

    return {
      low: central * 0.8,
      central,
      high: central * 1.25 * widen,
      clamped,
      excessRatio: excess,
      family,
      fitModel: fit.model,
      evidence: 'MODELED',
      sourceIds: fit.sourceIds,
    };
  }

  // ── Band helpers ─────────────────────────────────────────────────────────

  function band(low, central, high) {
    const c = central;
    return {
      low: low != null ? low : c,
      central: c,
      high: high != null ? high : c,
    };
  }

  function scaleBand(b, lowMul, highMul, centralMul) {
    return {
      low: b.low * lowMul,
      central: b.central * (centralMul != null ? centralMul : (lowMul + highMul) / 2),
      high: b.high * highMul,
    };
  }

  /**
   * Raise the ceiling to cover a value, never lower the floor.
   *
   * The floor of a prior is evidence-backed; a historical token fit is not
   * evidence that a current model uses LESS than its prior's minimum — it cannot
   * see hidden reasoning tokens at all. So a fit may say "this looks heavier than
   * assumed" and widen upward, and may never talk the floor down.
   */
  function widenUpTo(b, value) {
    return { low: b.low, central: b.central, high: Math.max(b.high, value) };
  }

  const CONFIDENCE_ORDER = ['high', 'medium', 'low', 'very-low'];
  function downgrade(confidence, steps) {
    const i = CONFIDENCE_ORDER.indexOf(confidence);
    if (i < 0) return 'very-low';
    return CONFIDENCE_ORDER[Math.min(CONFIDENCE_ORDER.length - 1, i + (steps || 1))];
  }

  // ── Base band selection ──────────────────────────────────────────────────

  /**
   * The evidence-backed starting band, before tokens, tools, and call counts.
   * Resolution order is deliberately conservative: a model-specific prior when we
   * know the model, the generic frontier distribution when we do not. There is no
   * branch that substitutes a flagship for an unknown label.
   */
  function selectBase(ctx) {
    const { canonicalModel, reasoning, reasoningClass, scenario } = ctx;

    if (reasoningClass === 'reasoning') {
      const prior = _P.reasoningPriorFor(canonicalModel, reasoning);
      if (prior) {
        const b = scenario === 'long' ? prior.bands.long : prior.bands.medium;
        return {
          profile: prior,
          band: band(b.low, b.central, b.high),
          evidence: prior.evidence,
          confidence: prior.confidence,
          scenarioScaled: true,
          openEnded: !!b.openEnded,
          assumptions: [
            `High-reasoning or agentic band for ${canonicalModel} (${reasoning || 'heavy mode'}), ${scenario === 'long' ? 'long/max' : 'medium'} regime.`,
          ].concat(prior.notes || []),
        };
      }
      // A heavy mode on a model we have no reasoning prior for: the generic
      // test-time-scaling distribution, never the model's ordinary prior.
      const generic = _P.genericFallback('reasoning');
      const gb = band(generic.energyWh.low, generic.energyWh.central, generic.energyWh.high);
      const assumptions = ['Generic test-time-scaling distribution: no reasoning prior exists for this model/mode combination.'];
      let widened = gb;
      if (scenario === 'long') {
        // Anchored to the independent GPT-5 long/high routing proxy rather than
        // multiplied by an invented factor.
        const anchor = _P.byId('gpt5_routing_proxy_long_high');
        widened = widenUpTo(gb, anchor.energyWh.central);
        assumptions.push(`Upper bound widened to the independent long/high routing proxy (${anchor.energyWh.central} Wh).`);
      }
      return {
        profile: generic,
        band: widened,
        evidence: generic.evidence,
        confidence: generic.confidence,
        scenarioScaled: true,
        openEnded: scenario === 'long',
        assumptions: assumptions.concat(generic.notes || []),
      };
    }

    const prior = _P.shortPriorFor(canonicalModel);
    if (prior) {
      const mul = _P.SCENARIO_MULTIPLIERS[scenario] || _P.SCENARIO_MULTIPLIERS.short;
      const base = band(prior.energyWh.low, prior.energyWh.central, prior.energyWh.high);
      const scaled = scenario === 'short' ? base : scaleBand(base, mul.low, mul.high);
      return {
        profile: prior,
        band: scaled,
        evidence: prior.evidence,
        confidence: prior.confidence,
        scenarioScaled: scenario !== 'short',
        assumptions: [`Basis: ${prior.basis}.`]
          .concat(scenario === 'short' ? [] : [`Scaled from the short prior by the ${scenario} scenario multiplier (${mul.low}x-${mul.high}x).`])
          .concat(prior.notes || []),
      };
    }

    const generic = _P.genericFallback('ordinary');
    const gb = band(generic.energyWh.low, generic.energyWh.central, generic.energyWh.high);
    const mul = _P.SCENARIO_MULTIPLIERS[scenario] || _P.SCENARIO_MULTIPLIERS.short;
    return {
      profile: generic,
      band: scenario === 'short' ? gb : scaleBand(gb, mul.low, mul.high),
      evidence: generic.evidence,
      confidence: generic.confidence,
      scenarioScaled: scenario !== 'short',
      assumptions: ['Model could not be resolved, so a generic frontier-model distribution is used instead of any named model.']
        .concat(generic.notes || []),
    };
  }

  // ── The estimate ─────────────────────────────────────────────────────────

  const DEFAULT_INPUT = {
    provider: 'unknown',
    surface: 'unknown',
    selectedModel: null,
    effectiveModel: null,
    modelConfidence: 0,
    routing: 'unknown',
    reasoning: 'unknown',
    tools: [],
    inputTokens: 0,
    phase: 'draft',
  };

  /** Expected visible output when the response does not exist yet. */
  function expectedOutput(input, scenarioHint) {
    if (typeof input.outputTokens === 'number') {
      return { low: input.outputTokens, central: input.outputTokens, high: input.outputTokens, observed: true };
    }
    if (input.outputTokensExpected) {
      return { ...input.outputTokensExpected, observed: false };
    }
    const heavy = classifyReasoning(input.reasoning, input.tools) === 'reasoning';
    // Pre-send we assume the published median output length for the regime, and
    // say so — this is the single biggest unknown before a response arrives.
    const central = heavy
      ? _P.genericFallback('reasoning').assumedMedianOutputTokens
      : _P.genericFallback('ordinary').assumedMedianOutputTokens;
    void scenarioHint;
    return { low: Math.round(central * 0.4), central, high: Math.round(central * 2.5), observed: false };
  }

  function estimate(rawInput) {
    const input = { ...DEFAULT_INPUT, ...(rawInput || {}) };
    const tools = Array.isArray(input.tools) ? input.tools.slice() : [];
    const inputTokens = Math.max(0, input.inputTokens || 0);
    const out = expectedOutput(input, null);
    const scenario = classifyScenario(inputTokens, out.central);
    const reasoningClass = classifyReasoning(input.reasoning, tools);
    // The model we estimate for is the one the provider says it actually used, if
    // it ever tells us; otherwise the one the user selected. Auto routing that
    // exposes nothing leaves this null and it STAYS null.
    const canonicalModel = input.effectiveModel || input.selectedModel || null;

    const base = selectBase({ canonicalModel, reasoning: input.reasoning, reasoningClass, scenario });
    let energy = base.band;
    const assumptions = base.assumptions.slice();
    const sourceIds = new Set(base.profile.sourceIds || []);

    // Token fit: shape inside the band, never a replacement for it. Only the
    // fit's CENTRAL value is allowed to move the band — its +-envelope is a
    // convenience for display, not evidence, and letting that drag the prior's
    // edges around would dress a guess up as a measurement.
    const family = proxyFamilyFor(input.provider);
    const fit = family ? tokenFitWh(family, inputTokens, out.central) : null;
    if (fit && inputTokens > 0) {
      const before = energy;
      energy = widenUpTo(energy, fit.central);
      if (fit.clamped) energy = widenUpTo(energy, fit.high);
      if (energy.high !== before.high) {
        assumptions.push(`Band widened to cover the historical ${fit.fitModel} token fit at ${inputTokens} input / ${Math.round(out.central)} output tokens. The fit describes ${fit.fitModel}, not the selected model.`);
      }
      fit.sourceIds.forEach((s) => sourceIds.add(s));
      if (fit.clamped) {
        assumptions.push(`Token counts exceed the range the proxy was fit to (${_P.EXTRAPOLATION_LIMIT.inputTokens} input / ${_P.EXTRAPOLATION_LIMIT.outputTokens} output). The fit was clamped there and the upper bound widened instead of extrapolated.`);
      }
      assumptions.push(_C.TOKENIZER);
    } else if (inputTokens > 0) {
      assumptions.push('No published token-level proxy exists for this provider, so the band is not adjusted for token count beyond the scenario shape.');
    }

    // Tool and routing overhead. Nothing a tool does is free, but from the page
    // we can only see THAT a tool is on, not what it cost — so it widens the top
    // of the band and is called out rather than being folded in silently.
    const overheadTools = tools.filter((t) => OVERHEAD_TOOLS.includes(t));
    const agenticTools = tools.filter((t) => AGENTIC_TOOLS.includes(t));
    if (overheadTools.length) {
      const mul = Math.min(2, 1 + 0.15 * overheadTools.length);
      energy = { low: energy.low, central: energy.central * ((1 + mul) / 2), high: energy.high * mul };
      assumptions.push(`Upper bound widened for active tools (${overheadTools.join(', ')}); their compute is estimated, not observed.`);
    }
    if (agenticTools.length) {
      assumptions.push(`Agentic tools active (${agenticTools.join(', ')}). Sub-agent, search, and code-execution calls are not visible to a content script.`);
    }
    if (input.routing === 'auto') {
      assumptions.push(_C.ROUTING_AUTO);
    }

    // Observed multi-call work multiplies the interaction; unobservable work
    // cannot, so we mark the result as a floor instead of inventing calls.
    const calls = Math.max(1, input.callCountObserved || 1);
    if (calls > 1) {
      energy = { low: energy.low * calls, central: energy.central * calls, high: energy.high * calls };
      assumptions.push(`${calls} model calls observed for this task.`);
    }
    // A result is a LOWER BOUND when we have positive reason to believe work
    // happened that the page did not show us: agentic tools, dynamic routing, or
    // a task we already know spans several calls. Plain "routing unknown" is not
    // one of those — it is the normal state of a fixed-model chat.
    const lowerBound = !!(agenticTools.length || input.routing === 'auto' || calls > 1);
    if (lowerBound) assumptions.push(_C.HIDDEN_CALLS);

    // Confidence: start from the profile, then pay for every unknown.
    let confidence = base.confidence;
    if (!canonicalModel) confidence = downgrade(confidence, 1);
    if (input.routing === 'auto' && !input.effectiveModel) confidence = downgrade(confidence, 1);

    const provider = input.provider;
    // Carbon: one named factor, its accounting method attached.
    const carbonFactor = _F.carbonFactorForProvider(provider, { deploymentKnown: false });
    const carbon = _F.carbonFromEnergy(energy, carbonFactor.id);
    (carbonFactor.sourceIds || []).forEach((s) => sourceIds.add(s));
    let carbonReference = null;
    if (provider === 'anthropic') {
      // The AWS proxy is a plausible centre but not a bound, so it is shown as a
      // separately labelled reference rather than merged into the range above.
      carbonReference = _F.carbonFromEnergy(energy, 'aws_anthropic_proxy');
    }

    // Water: cooling and full-operational are DIFFERENT quantities and get
    // different fields. A provider that has published only one gets only one.
    const water = { cooling: null, fullOperational: null, reported: null, note: _C.WATER_BOUNDARIES };
    if (provider === 'google') {
      water.cooling = _F.waterFromEnergy(energy, 'google_product_cooling');
      water.fullOperationalNote = 'Google has not published a full-operational water figure for this product; only cooling and associated infrastructure.';
    } else if (provider === 'openai') {
      water.fullOperational = _F.waterFromEnergy(energy, 'azure_full_operational');
      water.reported = _F.waterFromEnergy(energy, 'chatgpt_reported');
    } else if (provider === 'anthropic') {
      water.fullOperational = _F.waterFromEnergy(energy, 'aws_full_operational');
    } else {
      water.fullOperational = _F.waterFromEnergy(energy, 'hyperscaler_full_operational_range');
    }
    [water.cooling, water.fullOperational, water.reported].forEach((w) => {
      if (w) (w.sourceIds || []).forEach((s) => sourceIds.add(s));
    });

    // The product-level anchor for this surface travels with the estimate as
    // CONTEXT — it is what the provider actually published, and it is explicitly
    // not the model's footprint.
    const anchorProfile = _P.productAnchor(provider, input.surface);
    const productAnchor = anchorProfile ? {
      id: anchorProfile.id,
      energyWh: anchorProfile.energyWh.central,
      evidence: anchorProfile.evidence,
      confidence: anchorProfile.confidence,
      modelSpecific: false,
      sourceIds: anchorProfile.sourceIds,
      notes: anchorProfile.notes,
      warning: anchorProfile.evidence === 'REPORTED'
        ? 'Reported by the provider without a disclosed methodology; it is not a measurement and does not describe any specific model or mode.'
        : 'A product median across mixed traffic; it is not a measurement of the selected model.',
    } : null;
    if (productAnchor) productAnchor.sourceIds.forEach((s) => sourceIds.add(s));

    if (input.phase === 'draft') assumptions.push(_C.PRE_SEND);

    return {
      energyWh: { low: energy.low, central: energy.central, high: energy.high },
      carbon,
      carbonReference,
      water,
      evidence: base.evidence,
      confidence,
      assumptions,
      sourceIds: Array.from(sourceIds),
      sourceDate: _S.latestDate(Array.from(sourceIds)),
      modelSnapshotId: _P.SNAPSHOT_ID,
      profileId: base.profile.id,
      // Provenance of the numbers, for the expanded UI and for tests.
      unit: calls > 1 ? 'task' : 'interaction',
      phase: input.phase,
      scenario,
      reasoningClass,
      lowerBound,
      openEnded: !!base.openEnded,
      provider,
      surface: input.surface,
      selectedModel: input.selectedModel,
      effectiveModel: input.effectiveModel,
      canonicalModel,
      routing: input.routing,
      reasoning: input.reasoning,
      tools,
      inputTokens,
      outputTokens: out,
      tokenFit: inputTokens > 0 ? fit : null,
      productAnchor,
      disclosures: _C.disclosuresFor(
        { provider, routing: input.routing, canonicalModel, effectiveModel: input.effectiveModel },
        { evidence: base.evidence, lowerBound, phase: input.phase }
      ),
    };
  }

  /**
   * A task is the sum of the interactions we could actually see. When any of them
   * was a lower bound — or when the caller knows sub-calls were hidden — the total
   * says so instead of pretending completeness.
   */
  function estimateTask(interactions, opts) {
    const list = (interactions || []).filter(Boolean);
    const o = opts || {};
    const zero = { low: 0, central: 0, high: 0 };
    const energy = list.reduce((a, r) => ({
      low: a.low + r.energyWh.low,
      central: a.central + r.energyWh.central,
      high: a.high + r.energyWh.high,
    }), zero);
    const lowerBound = o.hiddenCallsPossible !== false && (list.some((r) => r.lowerBound) || !!o.hiddenCallsPossible);
    const assumptions = [`Summed ${list.length} observed model ${list.length === 1 ? 'call' : 'calls'}.`];
    if (lowerBound) assumptions.push(_C.HIDDEN_CALLS);
    const evidenceRank = { MEASURED: 0, REPORTED: 1, MODELED: 2, ENGINEERING_PRIOR: 3 };
    const evidence = list.reduce((worst, r) => (evidenceRank[r.evidence] > evidenceRank[worst] ? r.evidence : worst),
      list.length ? list[0].evidence : 'MODELED');
    const confidence = list.reduce((worst, r) => (
      CONFIDENCE_ORDER.indexOf(r.confidence) > CONFIDENCE_ORDER.indexOf(worst) ? r.confidence : worst
    ), list.length ? list[0].confidence : 'low');
    return {
      unit: 'task',
      callCount: list.length,
      energyWh: energy,
      evidence,
      confidence: lowerBound ? downgrade(confidence, 1) : confidence,
      lowerBound,
      assumptions,
      sourceIds: Array.from(new Set(list.flatMap((r) => r.sourceIds || []))),
      modelSnapshotId: _P.SNAPSHOT_ID,
      interactions: list,
    };
  }

  // ── Prompt savings ───────────────────────────────────────────────────────

  /**
   * What shortening a prompt is actually worth.
   *
   * Removing input tokens removes a slice of PREFILL, and prefill is a minority
   * of an interaction's energy at short and medium lengths. Fixed serving cost,
   * output decoding, hidden reasoning, routing, tools, and retries do not shrink
   * because the prompt got shorter — and a 2026 study of 28,421 trials found
   * compression can make output LONGER and quality worse, which is why
   * `expectedOutputGrowthFraction` is allowed to drive the result negative.
   */
  function projectInputSavings(args) {
    const a = args || {};
    const est = a.estimate;
    const original = Math.max(0, a.originalInputTokens || 0);
    const optimized = Math.max(0, a.optimizedInputTokens != null ? a.optimizedInputTokens : original);
    const tokensAvoided = Math.max(0, original - optimized);
    const scenario = a.scenario || (est && est.scenario) || 'short';
    const share = _P.INPUT_ENERGY_SHARE[scenario] || _P.INPUT_ENERGY_SHARE.short;
    const shareCentral = _P.geoMid(share.low, share.high);
    const fraction = original > 0 ? tokensAvoided / original : 0;
    const growth = Math.max(0, a.expectedOutputGrowthFraction || 0);

    // Gross: the share of total energy that input processing represents, times
    // how much of that input went away.
    const gross = { low: share.low * fraction, central: shareCentral * fraction, high: share.high * fraction };
    // Penalty: any growth in output/retries applies to the NON-input majority of
    // the interaction, which is why a small expected expansion erases a large
    // input reduction.
    const penalty = {
      low: growth * (1 - share.low),
      central: growth * (1 - shareCentral),
      high: growth * (1 - share.high),
    };
    const netFraction = {
      low: gross.low - penalty.low,
      central: gross.central - penalty.central,
      high: gross.high - penalty.high,
    };
    const energy = est ? est.energyWh : null;
    const scaleBy = (b) => (b ? {
      low: b.low * netFraction.low,
      central: b.central * netFraction.central,
      high: b.high * netFraction.high,
    } : null);
    const energySavedWh = scaleBy(energy);
    // Carbon and water follow the same net fraction and keep their labels — the
    // avoided share of an interaction is avoided under the same boundary the
    // interaction was estimated under, not under some other one.
    const water = est && est.water ? (est.water.fullOperational || est.water.cooling || est.water.reported) : null;
    const carbonSaved = est && est.carbon ? {
      ...scaleBy(est.carbon), scope: est.carbon.scope, accounting: est.carbon.accounting, factorId: est.carbon.factorId,
    } : null;
    const waterSaved = water ? {
      ...scaleBy(water), scope: water.scope, boundary: water.boundary, factorId: water.factorId,
    } : null;

    const warnings = [_C.SAVINGS];
    if (growth > 0) {
      warnings.push('Compression is expected to lengthen the response or trigger a follow-up, which can cancel or reverse the input-side reduction.');
    }
    warnings.push('Input compression alone is not a reliable production energy optimization: measured effects are provider-dependent and can include output expansion and quality loss.');

    return {
      tokensAvoided,
      inputReductionFraction: fraction,
      scenario,
      inputShare: { low: share.low, central: shareCentral, high: share.high },
      totalReductionPct: {
        low: netFraction.low * 100,
        central: netFraction.central * 100,
        high: netFraction.high * 100,
      },
      energySavedWh,
      carbonSaved,
      waterSaved,
      // "Saved" is only honest once both scenarios are complete and comparable.
      reliable: false,
      canReverse: growth > 0,
      label: (a.phase || (est && est.phase) || 'draft') === 'complete'
        ? _C.POST_RESPONSE_LABELS.reduction
        : _C.PRE_SEND_LABELS.inputReduction,
      warnings,
      sourceIds: ['S4', 'S5', 'S21'],
    };
  }

  // ── Display ──────────────────────────────────────────────────────────────
  // Precision is capped by the evidence: a prior quoted as "0.8-2.0 Wh" must not
  // be rendered as "1.2649 Wh".

  function sig(v) {
    if (!isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 10) return String(Math.round(v));
    if (abs >= 1) return v.toFixed(1);
    if (abs >= 0.01) return v.toFixed(2);
    return v.toFixed(3);
  }

  /** Decimal places appropriate to a magnitude — shared across a whole range. */
  function decimalsFor(magnitude) {
    const m = Math.abs(magnitude);
    if (m >= 10) return 0;
    if (m >= 1) return 1;
    if (m >= 0.01) return 2;
    return 3;
  }

  /**
   * "0.8–2.0 Wh" (or "1.2 Wh" when the band has collapsed).
   *
   * Both endpoints share one precision, chosen from the larger of the two: a
   * range printed as "0.80–2.0" reads like the low end was measured more finely
   * than the high end, which is the opposite of true.
   */
  function formatRange(b, unit, opts) {
    if (!b) return '—';
    const o = opts || {};
    const dp = decimalsFor(Math.max(Math.abs(b.low), Math.abs(b.high)));
    const lo = b.low.toFixed(dp);
    const hi = b.high.toFixed(dp);
    const suffix = o.openEnded ? '+' : '';
    if (lo === hi) return `${lo}${suffix} ${unit}`;
    return `${lo}–${hi}${suffix} ${unit}`;
  }

  /** A plain, serializable view of an estimate for the popup and the panel. */
  function formatEstimate(est) {
    if (!est) return null;
    return {
      energy: formatRange(est.energyWh, 'Wh', { openEnded: est.openEnded }),
      energyCentral: `${sig(est.energyWh.central)} Wh`,
      carbon: est.carbon ? `${formatRange(est.carbon, 'g CO2e')} (${est.carbon.accounting})` : null,
      carbonScope: est.carbon ? est.carbon.scope : null,
      waterCooling: est.water && est.water.cooling ? `${formatRange(est.water.cooling, 'mL')} (cooling)` : null,
      waterFullOperational: est.water && est.water.fullOperational ? `${formatRange(est.water.fullOperational, 'mL')} (full operational)` : null,
      waterReported: est.water && est.water.reported ? `${formatRange(est.water.reported, 'mL')} (boundary undisclosed)` : null,
      evidence: est.evidence,
      evidenceLabel: _C.EVIDENCE_LABEL[est.evidence] || est.evidence,
      confidence: est.confidence,
      sourceDate: est.sourceDate,
      sourceIds: est.sourceIds,
      citations: _S.cite(est.sourceIds),
      modelSnapshotId: est.modelSnapshotId,
      profileId: est.profileId,
      unit: est.unit,
      phase: est.phase,
      lowerBound: est.lowerBound,
      disclosures: est.disclosures,
    };
  }

  /** "2.5%" / "0.5–2.5%" for a savings projection, negatives kept visible. */
  function formatPercentRange(b) {
    if (!b) return '—';
    const lo = b.low.toFixed(1);
    const hi = b.high.toFixed(1);
    return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
  }

  const PFEstimator = {
    HEAVY_REASONING,
    AGENTIC_TOOLS,
    OVERHEAD_TOOLS,
    TOKEN_FITS,
    decimalsFor,
    classifyScenario,
    classifyReasoning,
    tokenFitWh,
    selectBase,
    estimate,
    estimateTask,
    projectInputSavings,
    formatRange,
    formatEstimate,
    formatPercentRange,
    sig,
  };

  if (root) root.PFEstimator = PFEstimator;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFEstimator;
})(typeof self !== 'undefined' ? self : this);
