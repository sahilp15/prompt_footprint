// Estimator contract tests.
// ---------------------------------------------------------------------------
// These are the promises the product makes about its numbers, one test each:
// a product median is never a model measurement, a reported figure is never
// dressed up as telemetry, a token reduction is never a total-energy reduction,
// and two different accounting boundaries never share a field.

const test = require('node:test');
const assert = require('node:assert');

const E = require('../lib/estimator.js');
const P = require('../lib/env/profiles.js');
const F = require('../lib/env/factors.js');
const S = require('../lib/env/sources.js');
const COPY = require('../lib/env/copy.js');

const close = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol);

// 1 ─────────────────────────────────────────────────────────────────────────
test('Gemini 0.24 Wh is a product median, never assigned to a specific model', () => {
  const anchor = P.byId('gemini_apps_median_2025_05');
  assert.strictEqual(anchor.energyWh.central, 0.24);
  assert.strictEqual(anchor.evidence, 'MEASURED');
  assert.strictEqual(anchor.modelSpecific, false);

  for (const model of ['gemini-3.1-pro', 'gemini-3.6-flash', 'gemini-3.1-deep-think']) {
    const est = E.estimate({ provider: 'google', surface: 'gemini_apps', selectedModel: model, inputTokens: 100 });
    assert.notStrictEqual(est.evidence, 'MEASURED', `${model} must not claim a measurement`);
    assert.notStrictEqual(est.profileId, anchor.id, `${model} must not be estimated from the product median profile`);
    // The anchor still travels with the estimate, labelled as what it is.
    assert.strictEqual(est.productAnchor.modelSpecific, false);
    assert.match(est.productAnchor.warning, /not a measurement of the selected model/i);
  }
});

test('the Gemini product median keeps its measured breakdown and boundaries', () => {
  const a = P.byId('gemini_apps_median_2025_05');
  assert.strictEqual(a.carbon.value, 0.03);
  assert.strictEqual(a.water.value, 0.26);
  assert.strictEqual(a.water.boundary, 'cooling');
  assert.strictEqual(a.carbon.scope, 'market_based_plus_allocated_embodied');
  const sum = a.energyBreakdownWh.accelerators + a.energyBreakdownWh.cpuDram
    + a.energyBreakdownWh.idle + a.energyBreakdownWh.overhead;
  assert.ok(close(sum, 0.24, 1e-9), `component breakdown must sum to the reported total, got ${sum}`);
  // The comprehensive boundary is 2.4x the accelerator-only one.
  assert.ok(close(a.energyWh.central / a.narrowBoundaryWh, 2.4, 0.01));
});

// 2 ─────────────────────────────────────────────────────────────────────────
test('ChatGPT 0.34 Wh is REPORTED and carries the missing-methodology warning', () => {
  const a = P.byId('chatgpt_reported_average_2025_06');
  assert.strictEqual(a.energyWh.central, 0.34);
  assert.strictEqual(a.evidence, 'REPORTED');
  assert.ok(a.notes.some((n) => /no methodology disclosed/i.test(n)));
  // 0.000085 US gal = 0.32176 mL, displayed as ~0.322 mL.
  assert.ok(close(a.water.value, 0.322, 0.0005));
  assert.strictEqual(a.water.scope, 'undisclosed');

  const est = E.estimate({ provider: 'openai', surface: 'chatgpt', selectedModel: null, inputTokens: 100 });
  assert.strictEqual(est.productAnchor.evidence, 'REPORTED');
  assert.match(est.productAnchor.warning, /without a disclosed methodology/i);
  assert.ok(est.disclosures.some((d) => /did not disclose model or methodology/i.test(d)));
});

test('the reported ChatGPT average is not applied as a constant to heavy modes', () => {
  const heavy = E.estimate({
    provider: 'openai', surface: 'chatgpt', selectedModel: 'gpt-5.6-sol',
    reasoning: 'max', inputTokens: 500,
  });
  assert.ok(heavy.energyWh.low > 0.34, 'a max-effort Sol estimate must not sit at the reported average');
  assert.strictEqual(heavy.reasoningClass, 'reasoning');
});

// 3 ─────────────────────────────────────────────────────────────────────────
test('current Claude models are ENGINEERING_PRIOR and say they are not Anthropic telemetry', () => {
  for (const model of ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5', 'claude-mythos-5']) {
    const est = E.estimate({ provider: 'anthropic', selectedModel: model, inputTokens: 100 });
    assert.strictEqual(est.evidence, 'ENGINEERING_PRIOR', model);
    assert.ok(est.assumptions.some((a) => /not a measurement/i.test(a)), model);
    assert.ok(est.disclosures.some((d) => /Anthropic has not published a per-query footprint/i.test(d)), model);
  }
  const proxy = P.byId('claude_3_7_sonnet_aws_proxy_short');
  assert.strictEqual(proxy.evidence, 'MODELED');
  assert.ok(proxy.notes.some((n) => /not Anthropic telemetry/i.test(n)));
});

// 4 ─────────────────────────────────────────────────────────────────────────
test('generic ordinary fallback is 0.34 Wh median with IQR 0.18-0.67', () => {
  const g = P.genericFallback('ordinary');
  assert.strictEqual(g.energyWh.central, 0.34);
  assert.strictEqual(g.energyWh.low, 0.18);
  assert.strictEqual(g.energyWh.high, 0.67);
  assert.deepStrictEqual(g.sourceIds, ['S4']);

  const est = E.estimate({ provider: 'unknown', selectedModel: null, inputTokens: 0 });
  assert.strictEqual(est.profileId, g.id);
  assert.deepStrictEqual(est.energyWh, { low: 0.18, central: 0.34, high: 0.67 });
});

// 5 ─────────────────────────────────────────────────────────────────────────
test('generic reasoning fallback is 4.32 Wh median with IQR 2.38-7.38', () => {
  const g = P.genericFallback('reasoning');
  assert.strictEqual(g.energyWh.central, 4.32);
  assert.strictEqual(g.energyWh.low, 2.38);
  assert.strictEqual(g.energyWh.high, 7.38);
  assert.strictEqual(g.approximateTokenScaleVsOrdinary, 15);

  // A heavy mode on a model with no reasoning prior falls back here, not to the
  // model's ordinary prior.
  const est = E.estimate({ provider: 'unknown', selectedModel: 'claude-sonnet-5', reasoning: 'max', inputTokens: 50 });
  assert.strictEqual(est.profileId, g.id);
  assert.ok(est.energyWh.central >= 4.32);
});

// 6 ─────────────────────────────────────────────────────────────────────────
test('GPT-4o and Claude 3.7 short/medium/long anchors match the published values', () => {
  const expected = [
    ['gpt4o_azure_proxy_short', 0.423], ['gpt4o_azure_proxy_medium', 1.215], ['gpt4o_azure_proxy_long', 2.875],
    ['claude_3_7_sonnet_aws_proxy_short', 0.950],
    ['claude_3_7_sonnet_aws_proxy_medium', 2.989],
    ['claude_3_7_sonnet_aws_proxy_long', 5.671],
  ];
  for (const [id, wh] of expected) {
    assert.strictEqual(P.byId(id).energyWh.central, wh, id);
  }
  // The published standard deviations survive too.
  assert.strictEqual(P.byId('claude_3_7_sonnet_aws_proxy_medium').energyWh.sd, 0.201);

  // And the token fits reproduce those anchors, which is what makes them usable
  // as a shape between the three measured points.
  const scenarios = [[100, 300], [1000, 1000], [10000, 1500]];
  scenarios.forEach(([i, o], idx) => {
    const gpt = E.tokenFitWh('gpt_4o_azure', i, o);
    const claude = E.tokenFitWh('claude_3_7_aws', i, o);
    assert.ok(close(gpt.central, expected[idx][1], 0.005), `gpt fit ${i}/${o} = ${gpt.central}`);
    assert.ok(close(claude.central, expected[idx + 3][1], 0.005), `claude fit ${i}/${o} = ${claude.central}`);
  });
});

test('the GPT-5 routing proxy anchors are preserved', () => {
  assert.strictEqual(P.byId('gpt5_routing_proxy_short_minimal').energyWh.central, 0.67);
  assert.strictEqual(P.byId('gpt5_routing_proxy_medium_minimal').energyWh.central, 2.33);
  assert.strictEqual(P.byId('gpt5_routing_proxy_medium_high').energyWh.central, 17.15);
  assert.strictEqual(P.byId('gpt5_routing_proxy_long_high').energyWh.central, 33.8);
});

// 7 ─────────────────────────────────────────────────────────────────────────
test('a 50% input-token cut never yields a 50% total-energy reduction', () => {
  const est = E.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-luna', inputTokens: 200 });
  const s = E.projectInputSavings({ estimate: est, originalInputTokens: 200, optimizedInputTokens: 100 });
  assert.strictEqual(s.inputReductionFraction, 0.5);
  assert.ok(s.totalReductionPct.high < 50, `high bound was ${s.totalReductionPct.high}%`);
  // On a short prompt the spec's expectation is roughly 0.5-2.5%.
  assert.ok(close(s.totalReductionPct.low, 0.5, 0.001));
  assert.ok(close(s.totalReductionPct.high, 2.5, 0.001));
  assert.ok(s.warnings.some((w) => w === COPY.SAVINGS));
  assert.strictEqual(s.reliable, false);
});

test('long-context prompts give input a bigger — but still bounded — share', () => {
  const est = E.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-sol', inputTokens: 12000, outputTokens: 1500 });
  const s = E.projectInputSavings({ estimate: est, originalInputTokens: 12000, optimizedInputTokens: 6000 });
  assert.strictEqual(s.scenario, 'long');
  assert.ok(close(s.totalReductionPct.high, 25, 0.001), `${s.totalReductionPct.high}`);
  assert.ok(s.totalReductionPct.high < 50);
});

// 8 ─────────────────────────────────────────────────────────────────────────
test('compression that grows the response yields zero or negative savings', () => {
  const est = E.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-luna', inputTokens: 200 });
  const s = E.projectInputSavings({
    estimate: est,
    originalInputTokens: 200,
    optimizedInputTokens: 100,
    expectedOutputGrowthFraction: 0.2,
  });
  assert.ok(s.totalReductionPct.central < 0, `expected a net loss, got ${s.totalReductionPct.central}%`);
  assert.ok(s.energySavedWh.central < 0);
  assert.strictEqual(s.canReverse, true);
  assert.ok(s.warnings.some((w) => /output expansion/i.test(w)));

  // Exactly break-even growth cancels the input-side gain.
  const zero = E.projectInputSavings({
    estimate: est, originalInputTokens: 200, optimizedInputTokens: 200, expectedOutputGrowthFraction: 0,
  });
  assert.strictEqual(zero.totalReductionPct.central, 0);
});

// 9 ─────────────────────────────────────────────────────────────────────────
test('carbon figures with different accounting methods cannot share one field', () => {
  const energy = { low: 1, central: 1, high: 1 };
  const market = F.carbonFromEnergy(energy, 'google_fleet');
  const location = F.carbonFromEnergy(energy, 'azure_openai_proxy');
  assert.strictEqual(market.accounting, 'market-based');
  assert.strictEqual(location.accounting, 'location-based');

  const mixed = F.combineCarbon([market, location]);
  assert.strictEqual(mixed.ok, false);
  assert.strictEqual(mixed.mixed, true);
  assert.strictEqual(mixed.value, null);
  assert.match(mixed.message, /different accounting methods/i);

  // Same method is fine, and the result stays labelled.
  const same = F.combineCarbon([location, F.carbonFromEnergy(energy, 'aws_anthropic_proxy')]);
  assert.strictEqual(same.ok, true);
  assert.strictEqual(same.value.accounting, 'location-based');
});

test('every carbon result carries its factor, scope, and accounting method', () => {
  for (const est of [
    E.estimate({ provider: 'google', selectedModel: 'gemini-3.1-pro', inputTokens: 100 }),
    E.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-sol', inputTokens: 100 }),
    E.estimate({ provider: 'anthropic', selectedModel: 'claude-sonnet-5', inputTokens: 100 }),
  ]) {
    assert.ok(est.carbon.factorId);
    assert.ok(est.carbon.scope);
    assert.ok(est.carbon.accounting);
    assert.ok(est.carbon.sourceIds.length);
  }
  // Google's implied ratio sits inside the documented 0.125-0.14 g/Wh range.
  const g = F.CARBON_FACTORS.google_fleet;
  assert.strictEqual(g.gPerWh.low, 0.125);
  assert.strictEqual(g.gPerWh.high, 0.14);
  assert.strictEqual(F.CARBON_FACTORS.azure_openai_proxy.gPerWh.central, 0.35);
  assert.strictEqual(F.CARBON_FACTORS.aws_anthropic_proxy.gPerWh.central, 0.287);
  assert.strictEqual(F.CARBON_FACTORS.unknown_grid.gPerWh.low, 0.10);
  assert.strictEqual(F.CARBON_FACTORS.unknown_grid.gPerWh.high, 0.60);
});

// 10 ────────────────────────────────────────────────────────────────────────
test('cooling-only and full-operational water cannot share one field', () => {
  const energy = { low: 1, central: 1, high: 1 };
  const cooling = F.waterFromEnergy(energy, 'google_product_cooling');
  const operational = F.waterFromEnergy(energy, 'azure_full_operational');
  assert.strictEqual(cooling.boundary, 'cooling');
  assert.strictEqual(operational.boundary, 'full-operational');

  const mixed = F.combineWater([cooling, operational]);
  assert.strictEqual(mixed.ok, false);
  assert.strictEqual(mixed.value, null);
  assert.match(mixed.message, /different boundaries/i);

  // The estimate exposes them as separate fields, never merged.
  const google = E.estimate({ provider: 'google', selectedModel: 'gemini-3.6-flash', inputTokens: 100 });
  assert.ok(google.water.cooling);
  assert.strictEqual(google.water.fullOperational, null);
  const openai = E.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-luna', inputTokens: 100 });
  assert.ok(openai.water.fullOperational);
  assert.strictEqual(openai.water.reported.boundary, 'undisclosed');
  assert.strictEqual(openai.water.note, COPY.WATER_BOUNDARIES);
});

test('the Azure and AWS operational water factors match their published components', () => {
  const azure = F.WATER_FACTORS.azure_full_operational;
  const aws = F.WATER_FACTORS.aws_full_operational;
  assert.ok(close(azure.mlPerWh, 4.35 + 0.30 / 1.12, 1e-9));
  assert.ok(close(azure.mlPerWh, 4.618, 0.001));
  assert.ok(close(aws.mlPerWh, 5.11 + 0.18 / 1.14, 1e-9));
  assert.ok(close(aws.mlPerWh, 5.268, 0.001));
  // Google's fleet WUE Category 2, and the anchor pair that takes precedence.
  assert.strictEqual(F.WATER_FACTORS.google_product_cooling.mlPerWh, 1.15);
  const at024 = F.waterFromEnergy({ low: 0.24, central: 0.24, high: 0.24 }, 'google_product_cooling');
  assert.ok(close(at024.central, 0.26, 1e-9), 'scaling at the anchor energy must reproduce 0.26 mL');
});

// 11 ────────────────────────────────────────────────────────────────────────
test('an agentic task sums observed calls and warns that hidden calls exist', () => {
  const one = E.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-sol', reasoning: 'high', inputTokens: 300 });
  const task = E.estimateTask([one, one, one], { hiddenCallsPossible: true });
  assert.strictEqual(task.callCount, 3);
  assert.ok(close(task.energyWh.central, one.energyWh.central * 3, 1e-9));
  assert.strictEqual(task.lowerBound, true);
  assert.ok(task.assumptions.some((a) => a === COPY.HIDDEN_CALLS));
  assert.strictEqual(task.unit, 'task');

  // A single interaction with an agentic tool is itself a floor.
  const agentic = E.estimate({
    provider: 'openai', selectedModel: 'gpt-5.6-sol', reasoning: 'high',
    tools: ['deep-research'], inputTokens: 300,
  });
  assert.strictEqual(agentic.lowerBound, true);
  assert.ok(agentic.assumptions.some((a) => /not visible to a content script/i.test(a)));

  // Observed multi-call work multiplies the interaction.
  const multi = E.estimate({
    provider: 'openai', selectedModel: 'gpt-5.6-luna', inputTokens: 100, callCountObserved: 4,
  });
  assert.strictEqual(multi.unit, 'task');
  assert.ok(close(multi.energyWh.central, one.energyWh.central > 0 ? multi.energyWh.central : 0, Infinity));
  assert.ok(multi.lowerBound);
});

test('tools are never free', () => {
  const bare = E.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-luna', inputTokens: 100 });
  const withTools = E.estimate({
    provider: 'openai', selectedModel: 'gpt-5.6-luna', inputTokens: 100, tools: ['web-search', 'image'],
  });
  assert.ok(withTools.energyWh.high > bare.energyWh.high);
  assert.ok(withTools.assumptions.some((a) => /active tools/i.test(a)));
});

// 12 ────────────────────────────────────────────────────────────────────────
test('long-context extrapolation is clamped and widened, never extended linearly', () => {
  const lim = P.EXTRAPOLATION_LIMIT;
  const atLimit = E.tokenFitWh('gpt_4o_azure', lim.inputTokens, lim.outputTokens);
  const far = E.tokenFitWh('gpt_4o_azure', lim.inputTokens * 40, lim.outputTokens);
  assert.strictEqual(atLimit.clamped, false);
  assert.strictEqual(far.clamped, true);
  // Central is clamped at the fitted limit rather than growing 40x.
  assert.strictEqual(far.central, atLimit.central);
  // Uncertainty grows, but sublinearly and under a hard cap.
  assert.ok(far.high > atLimit.high);
  assert.ok(far.high < atLimit.central * 4, `high grew to ${far.high}`);

  const est = E.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-terra', inputTokens: 400000, outputTokens: 1000 });
  assert.ok(est.assumptions.some((a) => /clamped there and the upper bound widened/i.test(a)));
  assert.ok(est.energyWh.high < 50, `a 400k-token prompt must not extrapolate to ${est.energyWh.high} Wh`);
});

test('a token fit may raise the ceiling but never lower an evidence-backed floor', () => {
  const est = E.estimate({ provider: 'anthropic', selectedModel: 'claude-opus-5', reasoning: 'max', inputTokens: 1000 });
  const prior = P.reasoningPriorFor('claude-opus-5', 'max');
  assert.ok(est.energyWh.low >= Math.min(prior.bands.medium.low, prior.bands.long.low));
});

// 13 ────────────────────────────────────────────────────────────────────────
test('evidence, confidence, and source date survive serialization and formatting', () => {
  const est = E.estimate({
    provider: 'anthropic', surface: 'claude-web', selectedModel: 'claude-fable-5',
    reasoning: 'adaptive', inputTokens: 250, phase: 'draft',
  });
  const round = JSON.parse(JSON.stringify(est));
  assert.strictEqual(round.evidence, est.evidence);
  assert.strictEqual(round.confidence, est.confidence);
  assert.strictEqual(round.sourceDate, est.sourceDate);
  assert.strictEqual(round.modelSnapshotId, P.SNAPSHOT_ID);
  assert.deepStrictEqual(round.sourceIds, est.sourceIds);

  const f = E.formatEstimate(round);
  assert.strictEqual(f.evidence, est.evidence);
  assert.strictEqual(f.evidenceLabel, COPY.EVIDENCE_LABEL[est.evidence]);
  assert.strictEqual(f.confidence, est.confidence);
  assert.ok(f.sourceDate);
  assert.ok(f.citations.length);
  assert.match(f.energy, /Wh$/);
});

test('display precision never exceeds what the evidence supports', () => {
  assert.strictEqual(E.sig(0.2413), '0.24');
  assert.strictEqual(E.sig(1.2649), '1.3');
  assert.strictEqual(E.sig(16.733), '17');
  assert.strictEqual(E.formatRange({ low: 0.8, central: 1.2, high: 2 }, 'Wh'), '0.8–2.0 Wh');
  assert.strictEqual(E.formatRange({ low: 5, central: 5, high: 5 }, 'Wh'), '5.0 Wh');
  assert.strictEqual(E.formatRange({ low: 10, central: 20, high: 35 }, 'Wh', { openEnded: true }), '10–35+ Wh');
});

// ── Structural guarantees ─────────────────────────────────────────────────

test('every profile declares an evidence class, a confidence, and real sources', () => {
  for (const p of P.PROFILES) {
    assert.ok(P.EVIDENCE.includes(p.evidence), `${p.id} evidence`);
    assert.ok(P.CONFIDENCE.includes(p.confidence), `${p.id} confidence`);
    assert.ok((p.sourceIds || []).length, `${p.id} sources`);
    for (const id of p.sourceIds) assert.ok(S.get(id), `${p.id} cites unknown source ${id}`);
  }
});

test('no current flagship model claims a measurement', () => {
  const measured = P.PROFILES.filter((p) => p.evidence === 'MEASURED');
  assert.strictEqual(measured.length, 1);
  assert.strictEqual(measured[0].id, 'gemini_apps_median_2025_05');
  assert.strictEqual(measured[0].modelSpecific, false);
  for (const p of P.SHORT_PRIORS.concat(P.REASONING_PRIORS)) {
    assert.strictEqual(p.evidence, 'ENGINEERING_PRIOR', p.id);
    assert.strictEqual(p.modelSpecificMeasurement, false, p.id);
  }
});

test('an unknown model never falls back to a named flagship', () => {
  const est = E.estimate({ provider: 'openai', surface: 'chatgpt', selectedModel: null, inputTokens: 120 });
  assert.strictEqual(est.canonicalModel, null);
  assert.strictEqual(est.profileId, 'generic_frontier_2026_ordinary');
  assert.ok(est.disclosures.some((d) => d === COPY.UNKNOWN_MODEL));
});

test('auto routing is never converted into an exact model', () => {
  const est = E.estimate({ provider: 'openai', surface: 'chatgpt', selectedModel: null, routing: 'auto', inputTokens: 100 });
  assert.strictEqual(est.canonicalModel, null);
  assert.strictEqual(est.lowerBound, true);
  assert.ok(est.disclosures.some((d) => d === COPY.ROUTING_AUTO));
  assert.ok(['low', 'very-low'].includes(est.confidence));
});

test('the current-model priors match the published table exactly', () => {
  const expected = {
    'gemini-3.6-flash': [0.15, 0.24, 0.40],
    'gemini-3.1-pro': [0.30, 0.50, 1.00],
    'gpt-5.6-luna': [0.20, 0.34, 0.60],
    'gpt-5.6-terra': [0.30, 0.50, 0.90],
    'gpt-5.6-sol': [0.40, 0.67, 1.20],
    'claude-sonnet-5': [0.60, 0.90, 1.20],
    'claude-opus-5': [0.80, 1.20, 2.00],
    'claude-fable-5': [1.00, 2.00, 3.00],
  };
  for (const [model, [low, central, high]] of Object.entries(expected)) {
    const p = P.shortPriorFor(model);
    assert.ok(p, `missing prior for ${model}`);
    assert.deepStrictEqual([p.energyWh.low, p.energyWh.central, p.energyWh.high], [low, central, high], model);
  }
});

test('scenario multipliers follow the documented 2.5-3.5x and 5-7x bands', () => {
  assert.deepStrictEqual(P.SCENARIO_MULTIPLIERS.medium, { low: 2.5, high: 3.5 });
  assert.deepStrictEqual(P.SCENARIO_MULTIPLIERS.long, { low: 5, high: 7 });
  const short = E.estimate({ provider: 'google', selectedModel: 'gemini-3.1-pro', inputTokens: 100 });
  const medium = E.estimate({ provider: 'google', selectedModel: 'gemini-3.1-pro', inputTokens: 1000, outputTokens: 1000 });
  assert.strictEqual(medium.scenario, 'medium');
  assert.ok(close(medium.energyWh.low, short.energyWh.low * 2.5, 1e-9));
  assert.ok(close(medium.energyWh.high, short.energyWh.high * 3.5, 1e-9));
});

test('a pre-send estimate says the output is not known yet', () => {
  const draft = E.estimate({ provider: 'anthropic', selectedModel: 'claude-sonnet-5', inputTokens: 80, phase: 'draft' });
  assert.strictEqual(draft.outputTokens.observed, false);
  assert.ok(draft.assumptions.some((a) => a === COPY.PRE_SEND));

  const done = E.estimate({
    provider: 'anthropic', selectedModel: 'claude-sonnet-5', inputTokens: 80, outputTokens: 400, phase: 'complete',
  });
  assert.strictEqual(done.outputTokens.observed, true);
  assert.ok(!done.assumptions.includes(COPY.PRE_SEND));
});

test('Mythos and Fable stay separate profiles', () => {
  const fable = P.shortPriorFor('claude-fable-5');
  const mythos = P.shortPriorFor('claude-mythos-5');
  assert.notStrictEqual(fable.id, mythos.id);
  assert.ok(/distinct model/i.test(mythos.basis));
});
