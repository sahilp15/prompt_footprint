// UI contract tests: required copy, honest labels, safe migration.
// ---------------------------------------------------------------------------
// The estimator can be perfectly calibrated and the product still be dishonest
// if the surface drops the caveats. These tests pin the sentences the UI is
// required to show, the labels it must use for uncertainty, and the guarantee
// that upgrading the estimator does not rewrite what a user was shown before.

const test = require('node:test');
const assert = require('node:assert');

const PRESENT = require('../lib/models/present.js');
const COPY = require('../lib/env/copy.js');
const OBS = require('../lib/models/observation.js');
const EST = require('../lib/estimator.js');
const Storage = require('../lib/storage.js');

function installChromeMock(seed) {
  const backing = { ...(seed || {}) };
  global.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          if (keys == null) Object.assign(out, backing);
          else (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in backing) out[k] = backing[k]; });
          cb(out);
        },
        set(obj, cb) { Object.assign(backing, obj); cb(); },
      },
    },
  };
  return backing;
}

// ── Required copy ─────────────────────────────────────────────────────────

test('each provider carries its required disclosure sentence', () => {
  assert.match(COPY.PROVIDER.google, /Google measured a median Gemini Apps text interaction at 0\.24 Wh in May 2025\./);
  assert.match(COPY.PROVIDER.google, /product median, not a measurement of the selected model/);
  assert.match(COPY.PROVIDER.openai, /OpenAI reported ~0\.34 Wh for an average ChatGPT query but did not disclose model or methodology details\./);
  assert.match(COPY.PROVIDER.anthropic, /Anthropic has not published a per-query footprint\. This is an independent modelled range\./);
  assert.match(COPY.ROUTING_AUTO, /may route this request dynamically/);
  assert.match(COPY.WATER_BOUNDARIES, /Cooling and broader operational water use different boundaries and are shown separately\./);
  assert.match(COPY.SAVINGS, /Fewer input tokens do not imply the same percentage reduction in total interaction energy\./);
});

test('an estimate carries the disclosures its situation requires', () => {
  const auto = EST.estimate({ provider: 'openai', surface: 'chatgpt', selectedModel: null, routing: 'auto', inputTokens: 90, phase: 'draft' });
  assert.ok(auto.disclosures.includes(COPY.PROVIDER.openai));
  assert.ok(auto.disclosures.includes(COPY.ROUTING_AUTO));
  assert.ok(auto.disclosures.includes(COPY.UNKNOWN_MODEL));
  assert.ok(auto.disclosures.includes(COPY.HIDDEN_CALLS));
  assert.ok(auto.disclosures.includes(COPY.PRE_SEND));
  assert.ok(auto.disclosures.includes(COPY.WATER_BOUNDARIES));

  const fixed = EST.estimate({ provider: 'google', selectedModel: 'gemini-3.1-pro', routing: 'fixed', inputTokens: 90, phase: 'complete', outputTokens: 300 });
  assert.ok(fixed.disclosures.includes(COPY.PROVIDER.google));
  assert.ok(!fixed.disclosures.includes(COPY.ROUTING_AUTO));
  assert.ok(!fixed.disclosures.includes(COPY.UNKNOWN_MODEL));
});

// ── Honest labels ─────────────────────────────────────────────────────────

test('an unresolved model is never rendered as a flagship', () => {
  assert.strictEqual(PRESENT.modelLabel(OBS.emptyObservation({})), 'No model detected');
  // A label the registry has never seen is still a KNOWN selection — the product
  // showed it to us. It is displayed verbatim, with no hedging word attached and
  // no rounding to the nearest model we do know. The uncertainty about what it
  // COSTS lives on the estimate, not on the model's name.
  const unmapped = OBS.emptyObservation({ provider: 'openai', selectedLabel: 'GPT-7.2 Nimbus' });
  assert.strictEqual(PRESENT.modelLabel(unmapped), 'GPT-7.2 Nimbus');
  assert.strictEqual(OBS.toDetectedModel(unmapped).canonicalModelId, null);
  assert.strictEqual(OBS.toDetectedModel(unmapped).estimateBasis, 'provider-fallback');
  assert.ok(!/probably|maybe|likely|not sure|unknown/i.test(PRESENT.modelLabel(unmapped)));
  assert.strictEqual(
    PRESENT.modelLabel(OBS.emptyObservation({ provider: 'openai', routing: 'auto' })),
    'Auto — effective model not exposed'
  );
  assert.strictEqual(
    PRESENT.modelLabel(OBS.emptyObservation({ provider: 'anthropic', canonicalModel: 'claude-fable-5' })),
    'Claude Fable 5'
  );
  assert.strictEqual(
    PRESENT.modelLabel(OBS.emptyObservation({ provider: 'openai', routing: 'auto', effectiveModel: 'gpt-5.6-sol' })),
    'GPT-5.6 Sol (effective)'
  );
});

test('the collapsed summary always pairs a range with an evidence badge', () => {
  const obs = OBS.emptyObservation({ provider: 'anthropic', canonicalModel: 'claude-opus-5', routing: 'fixed', reasoningMode: 'medium' });
  const est = EST.estimate({ provider: 'anthropic', selectedModel: 'claude-opus-5', reasoning: 'medium', inputTokens: 120, phase: 'draft' });
  const s = PRESENT.collapsedSummary(obs, est, { inputTokens: 120, tokensAvoided: 18 });
  assert.strictEqual(s.provider, 'Claude');
  assert.strictEqual(s.model, 'Claude Opus 5');
  assert.match(s.energyRange, /–.*Wh$/, 'a single scalar is never enough');
  assert.strictEqual(s.evidence, 'ENGINEERING_PRIOR');
  assert.strictEqual(s.evidenceLabel, 'Assumption');
  assert.strictEqual(s.energyLabel, COPY.PRE_SEND_LABELS.projectedRange);
  assert.strictEqual(s.tokensAvoidedLabel, COPY.PRE_SEND_LABELS.tokensAvoided);
  assert.strictEqual(s.unknownModel, false);
});

test('pre-send wording never claims a saving; post-response wording is separate', () => {
  const draft = EST.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-luna', inputTokens: 100, phase: 'draft' });
  const done = EST.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-luna', inputTokens: 100, outputTokens: 400, phase: 'complete' });
  assert.strictEqual(PRESENT.collapsedSummary({}, draft, {}).energyLabel, 'Projected interaction range');
  assert.strictEqual(PRESENT.collapsedSummary({}, done, {}).energyLabel, 'Estimated interaction footprint');

  const preSend = EST.projectInputSavings({ estimate: draft, originalInputTokens: 100, optimizedInputTokens: 60 });
  assert.strictEqual(preSend.label, 'Estimated input-processing reduction');
  assert.ok(!/saved/i.test(preSend.label));
  const post = EST.projectInputSavings({ estimate: done, originalInputTokens: 100, optimizedInputTokens: 60, phase: 'complete' });
  assert.strictEqual(post.label, 'Modelled reduction versus the original-prompt scenario');
});

test('the expanded view shows cooling and full-operational water as separate rows', () => {
  const obs = OBS.emptyObservation({ provider: 'openai', canonicalModel: 'gpt-5.6-sol', routing: 'fixed' });
  const est = EST.estimate({ provider: 'openai', surface: 'chatgpt', selectedModel: 'gpt-5.6-sol', inputTokens: 100, outputTokens: 300, phase: 'complete' });
  const rows = PRESENT.expandedRows(obs, est);
  const labels = rows.map((r) => r.label);
  assert.ok(labels.includes('Water — full operational'));
  assert.ok(labels.includes('Water — as reported'));
  assert.ok(labels.includes('Carbon'));
  assert.ok(labels.includes('Sources'));
  assert.ok(labels.includes('Evidence as of'));
  assert.ok(labels.includes('Provider anchor'));
  // No row merges two boundaries.
  const waterRows = rows.filter((r) => r.label.startsWith('Water'));
  assert.ok(waterRows.length >= 2);
  const boundaries = new Set(waterRows.map((r) => r.value));
  assert.strictEqual(boundaries.size, waterRows.length, 'each water row must show a distinct figure');
});

test('a model change is explained rather than silently applied', () => {
  const prev = OBS.emptyObservation({ provider: 'anthropic', canonicalModel: 'claude-opus-5' });
  const next = OBS.emptyObservation({ provider: 'anthropic', canonicalModel: 'claude-sonnet-5' });
  const a = EST.estimate({ provider: 'anthropic', selectedModel: 'claude-opus-5', inputTokens: 100 });
  const b = EST.estimate({ provider: 'anthropic', selectedModel: 'claude-sonnet-5', inputTokens: 100 });
  const text = PRESENT.changeExplanation(prev, next, a, b);
  assert.match(text, /Model changed from Claude Opus 5 to Claude Sonnet 5/);
  assert.match(text, /Projected range moved from/);
  assert.match(text, /Messages already sent keep the model they were sent with\./);
  // No previous state means nothing to explain.
  assert.strictEqual(PRESENT.changeExplanation(null, next, null, b), null);
  assert.strictEqual(PRESENT.changeExplanation(prev, prev, a, a), null);
});

test('HTML from a hostile label is escaped before it reaches the panel', () => {
  const out = PRESENT.escapeHtml('<img src=x onerror="alert(1)">');
  assert.ok(!out.includes('<'));
  assert.ok(!out.includes('"'));
});

// ── Storage migration ─────────────────────────────────────────────────────

test('migration stamps legacy records without changing a single number', async () => {
  const legacy = {
    id: 's1', userId: 'u1', platform: 'chatgpt', startTime: new Date().toISOString(),
    totalTokens: 400, totalEnergyWh: 0.42, totalWaterMl: 1.4, totalCo2G: 0.15, queryCount: 1,
    queries: [{ id: 'q1', totalTokens: 400, energyWh: 0.42, waterMl: 1.4, co2G: 0.15 }],
  };
  const backing = installChromeMock({ pf_session_s1: JSON.parse(JSON.stringify(legacy)) });

  const result = await Storage.migrateStorage();
  assert.strictEqual(result.from, 1);
  assert.strictEqual(result.to, Storage.CURRENT_SCHEMA);
  assert.strictEqual(result.migrated, 1);

  const stored = backing.pf_session_s1;
  assert.strictEqual(stored.estimatorVersion, Storage.LEGACY_ESTIMATOR);
  assert.strictEqual(stored.queries[0].estimatorVersion, Storage.LEGACY_ESTIMATOR);
  // Every recorded value is untouched: history is a record of what the user was
  // shown, and recomputing it under a new estimator would falsify that record.
  assert.strictEqual(stored.totalEnergyWh, legacy.totalEnergyWh);
  assert.strictEqual(stored.totalWaterMl, legacy.totalWaterMl);
  assert.strictEqual(stored.totalCo2G, legacy.totalCo2G);
  assert.deepStrictEqual(stored.queries[0].energyWh, legacy.queries[0].energyWh);
  assert.strictEqual(backing.pf_schema, Storage.CURRENT_SCHEMA);
});

test('migration is idempotent and never re-stamps', async () => {
  installChromeMock({ pf_session_s1: { id: 's1', queries: [] } });
  await Storage.migrateStorage();
  const second = await Storage.migrateStorage();
  assert.strictEqual(second.migrated, 0);
  assert.strictEqual(second.from, Storage.CURRENT_SCHEMA);

  // Pure helper: a session that already declares its estimator is left alone.
  const already = { id: 'x', estimatorVersion: 'prior_gpt-5.6-sol_short_2026', queries: [] };
  const out = Storage.migrateSession(already);
  assert.strictEqual(out.changed, false);
  assert.strictEqual(out.session, already);
});

test('new query records carry the band, the boundaries, and the model identity', async () => {
  installChromeMock();
  const session = await Storage.createSession('u1', 'claude');
  const est = EST.estimate({
    provider: 'anthropic', surface: 'claude-web', selectedModel: 'claude-sonnet-5',
    inputTokens: 120, outputTokens: 400, phase: 'complete',
  });
  const record = await Storage.addQuery(session.id, {
    platform: 'claude',
    promptTokens: 120, responseTokens: 400, totalTokens: 520,
    energyWh: est.energyWh.central,
    energyWhLow: est.energyWh.low,
    energyWhHigh: est.energyWh.high,
    waterFullOperationalMl: est.water.fullOperational.central,
    waterBoundary: est.water.fullOperational.boundary,
    carbonScope: est.carbon.scope,
    carbonAccounting: est.carbon.accounting,
    evidence: est.evidence,
    confidence: est.confidence,
    canonicalModel: est.canonicalModel,
    routing: est.routing,
    modelSnapshotId: est.modelSnapshotId,
    estimatorVersion: est.profileId,
  });

  assert.strictEqual(record.evidence, 'ENGINEERING_PRIOR');
  assert.strictEqual(record.canonicalModel, 'claude-sonnet-5');
  assert.strictEqual(record.waterBoundary, 'full-operational');
  assert.ok(record.energyWhLow < record.energyWh && record.energyWh < record.energyWhHigh);
  assert.strictEqual(record.modelSnapshotId, est.modelSnapshotId);

  // A record written without the new fields still works — they are all optional.
  const bare = await Storage.addQuery(session.id, { totalTokens: 10, energyWh: 0.01 });
  assert.strictEqual(bare.evidence, undefined);
  assert.strictEqual(bare.totalTokens, 10);
});
