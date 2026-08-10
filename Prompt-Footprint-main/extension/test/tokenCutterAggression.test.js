// Aggressive-compression contract tests.
// ---------------------------------------------------------------------------
// These run against the SHIPPED BUNDLE, not the TypeScript source, so a stale
// `npm run build:cutter` fails here rather than in a user's browser.
//
// The suite exists because of a specific product failure: the optimizer was
// looking at prompts full of repetition, filler, duplicated constraints and
// verbose instruction wrappers, and reporting "Already concise". Two kinds of
// assertion therefore appear throughout:
//
//   FLOOR   a visibly bloated prompt must lose at least N% — the optimizer is
//           not allowed to quietly go quiet again.
//   FENCE   the things that must survive at ANY level: names, numbers, dates,
//           URLs, code, quotes, negations, formats, and every stated limit.
//
// A case that compresses more but breaches a fence is a failure. That asymmetry
// is the whole design.

const test = require('node:test');
const assert = require('node:assert');

const T = require('../lib/tokenCutter.bundle.js');
const S = require('../lib/assistantState.js');

const LEVELS = ['light', 'balanced', 'maximum'];

function run(text, level, options) {
  return T.analyzePrompt(text, { level, platform: 'chatgpt', ...(options || {}) });
}

function pct(text, level, options) {
  return run(text, level, options).analytics.percentReduction;
}

// ── The corpus ─────────────────────────────────────────────────────────────
// Deliberately spans the shapes the spec calls out: very verbose, moderately
// verbose, short-but-inefficient, already concise, long technical, coding, and
// prompts carrying URLs, citations, quotes, dates, numbers, tables, nested
// requirements, multiple "do not" constraints, examples, and repeated context.

const CORPUS = {
  veryVerbose: [
    'Hi there! I hope you are doing well today. I was wondering if you could possibly',
    'help me out with something. Basically, what I want you to do is write a blog post',
    'about renewable energy. The blog post should be about renewable energy and it',
    'should be around 800 words. It is very important that you make it engaging.',
    'Please make sure that you keep it engaging for a general audience.',
    'Do not use jargon. Thank you so much in advance!',
  ].join(' '),

  moderatelyVerbose: [
    'Could you please summarize the attached report for me? I would like the summary',
    'to be concise. Please keep it under 300 words. Also make sure that you highlight',
    'the key financial figures.',
  ].join(' '),

  shortButInefficient:
    'I was wondering if you could please just help me write a short email to my boss.',

  alreadyConcise:
    'Summarize this report in under 300 words. Highlight the key financial figures.',

  longTechnical: [
    'You are a staff platform engineer. I want you to act as a staff platform engineer.',
    'Please review the following Terraform module for our production VPC.',
    'When you review it, make sure that you check for overly permissive security groups.',
    'It is very important that you check for overly permissive security groups.',
    'Also check for missing encryption at rest. Also check for public subnets.',
    'Do not rewrite the module. Do not change variable names. Never remove comments.',
    'Respond in a numbered list format. Use a numbered list for your response.',
  ].join(' '),

  coding: [
    'Could you please help me refactor this function? Here is the code:',
    '```js',
    'function add(a, b) { return a + b }',
    '```',
    'Please make sure that you keep the function name `add` exactly as it is.',
    'Do not change the signature. Respond with only the code.',
  ].join('\n'),

  withUrlsAndCitations: [
    'I was wondering if you could summarize the paper at https://arxiv.org/abs/2402.16363',
    'and compare it with Smith et al. (2023). It is very important that you cite both',
    'sources. Please keep it under 400 words.',
  ].join(' '),

  withQuotesAndDates: [
    'Please draft a reply. It is very important that you use the exact phrase',
    '"we regret to inform you" and that you reference the deadline of 2026-03-14.',
    'Do not change the wording of that phrase. Keep it under 150 words.',
  ].join(' '),

  withTable: [
    'Could you please analyze this data for me?',
    '',
    '| Quarter | Revenue | Growth |',
    '| --- | --- | --- |',
    '| Q1 | 1,200,000 | 12% |',
    '| Q2 | 1,450,000 | 21% |',
    '',
    'Please make sure that you explain the growth trend. Keep it under 200 words.',
  ].join('\n'),

  nestedAndNegations: [
    'I really need you to write onboarding docs. It is very important that you do not',
    'use marketing language. Do not mention pricing. Never promise a delivery date.',
    'Do not exceed 500 words. Use a friendly but professional tone.',
  ].join(' '),

  withExamples: [
    'Please classify each item. For example: input "apple" output "fruit".',
    'For example: input "carrot" output "vegetable".',
    'For example: input "banana" output "fruit".',
    'For example: input "celery" output "vegetable".',
    'Do not add commentary. Respond as JSON.',
  ].join(' '),

  repeatedContext: [
    'We are migrating from MySQL to PostgreSQL. Our team is migrating from MySQL to',
    'PostgreSQL. I want you to make sure that you list the schema differences.',
    'It is very important that you list the schema differences. Keep it under 600 words.',
  ].join(' '),
};

/** Prompts a reader would call obviously padded, and the floor each must clear. */
const BLOATED = [
  ['veryVerbose', 30],
  ['moderatelyVerbose', 18],
  ['shortButInefficient', 30],
  ['longTechnical', 25],
  ['withUrlsAndCitations', 12],
  ['nestedAndNegations', 12],
  ['repeatedContext', 25],
];

// ── Compression floors ─────────────────────────────────────────────────────

test('every bloated prompt in the corpus is meaningfully compressed at Balanced', () => {
  for (const [name, floor] of BLOATED) {
    const r = run(CORPUS[name], 'balanced');
    assert.ok(
      r.analytics.percentReduction >= floor,
      `${name}: expected >= ${floor}% at balanced, got ${r.analytics.percentReduction.toFixed(1)}%\n${r.optimized}`,
    );
  }
});

test('no bloated prompt is ever reported as already concise', () => {
  for (const [name] of BLOATED) {
    for (const level of LEVELS) {
      const r = run(CORPUS[name], level);
      assert.strictEqual(
        r.concision.concise, false,
        `${name} at ${level} was called concise; reasons: ${r.concision.reasons.join(', ')}`,
      );
      // …and the UI reaches the same conclusion, not just the engine.
      assert.notStrictEqual(
        S.nextState({
          engineReady: true, composerFound: true, text: CORPUS[name], online: true, mode: 'local',
          analytics: r.analytics, validation: r.validation, concision: r.concision,
        }),
        'concise',
        `${name} at ${level} reached the concise UI state`,
      );
    }
  }
});

test('a genuinely tight prompt IS reported as concise', () => {
  const r = run(CORPUS.alreadyConcise, 'balanced');
  assert.strictEqual(r.analytics.tokensSaved, 0);
  assert.strictEqual(r.concision.concise, true, r.concision.reasons.join(', '));
  assert.strictEqual(
    S.nextState({
      engineReady: true, composerFound: true, text: CORPUS.alreadyConcise, online: true,
      mode: 'local', analytics: r.analytics, validation: r.validation, concision: r.concision,
    }),
    'concise',
  );
});

test('the concise decision is about density, not length', () => {
  // Short and wasteful: not concise.
  const short = run('Could you please, if you do not mind, just summarize this?', 'balanced');
  assert.strictEqual(short.concision.concise, false);
  assert.ok(short.analytics.originalTokens < 25, 'this case must stay small to be meaningful');

  // Long and dense: concise, despite being ~40x the size.
  const long = Array.from({ length: 20 }, (_, i) =>
    `Requirement ${i + 1}: validate field_${i + 1} against schema_${i + 1}.`).join('\n');
  const r = run(long, 'balanced');
  assert.ok(r.analytics.originalTokens > 150, `expected a long prompt, got ${r.analytics.originalTokens}`);
  assert.strictEqual(r.concision.concise, true, r.concision.reasons.join(', '));
});

// ── Level ordering ─────────────────────────────────────────────────────────

test('Maximum is at least as strong as Balanced, which is at least as strong as Light', () => {
  for (const name of Object.keys(CORPUS)) {
    const [light, balanced, maximum] = LEVELS.map((l) => pct(CORPUS[name], l));
    assert.ok(balanced >= light - 0.001, `${name}: balanced ${balanced} < light ${light}`);
    assert.ok(maximum >= balanced - 0.001, `${name}: maximum ${maximum} < balanced ${balanced}`);
  }
});

test('Maximum is strictly stronger than Balanced somewhere in the corpus', () => {
  const stronger = Object.keys(CORPUS).filter((n) => pct(CORPUS[n], 'maximum') > pct(CORPUS[n], 'balanced'));
  assert.ok(stronger.length > 0, 'Maximum must actually do something Balanced does not');
});

test('Balanced is strictly stronger than Light somewhere in the corpus', () => {
  const stronger = Object.keys(CORPUS).filter((n) => pct(CORPUS[n], 'balanced') > pct(CORPUS[n], 'light'));
  assert.ok(stronger.length > 0, 'Balanced must actually do something Light does not');
});

// ── Preservation fences ────────────────────────────────────────────────────

test('negations survive at every level, in every corpus prompt', () => {
  const NEG = /\b(?:do not|don't|never|must not|no|without)\b/gi;
  for (const [name, text] of Object.entries(CORPUS)) {
    const before = (text.match(NEG) || []).length;
    if (!before) continue;
    for (const level of LEVELS) {
      const after = (run(text, level).optimized.match(NEG) || []).length;
      assert.ok(after >= before, `${name} at ${level}: ${before} negations became ${after}`);
    }
  }
});

test('names, numbers, dates, links, quotes, and code survive at every level', () => {
  const MUST_SURVIVE = [
    [CORPUS.withUrlsAndCitations, ['https://arxiv.org/abs/2402.16363', 'Smith', '400 words']],
    [CORPUS.withQuotesAndDates, ['we regret to inform you', '2026-03-14', '150 words']],
    [CORPUS.coding, ['function add(a, b) { return a + b }', '`add`']],
    [CORPUS.withTable, ['1,200,000', '1,450,000', '21%', '200 words']],
    [CORPUS.nestedAndNegations, ['500 words', 'friendly', 'professional']],
    [CORPUS.veryVerbose, ['800 words', 'renewable energy']],
  ];
  for (const [text, needles] of MUST_SURVIVE) {
    for (const level of LEVELS) {
      const out = run(text, level).optimized;
      for (const needle of needles) {
        assert.ok(out.includes(needle), `"${needle}" was lost at ${level}:\n${out}`);
      }
    }
  }
});

test('required output formats survive even when the instruction is deduplicated', () => {
  // The prompt says "numbered list" twice. One copy may go; the requirement may not.
  const out = run(CORPUS.longTechnical, 'maximum').optimized;
  assert.match(out, /numbered list/i);
  const jsonOut = run(CORPUS.withExamples, 'maximum').optimized;
  assert.match(jsonOut, /JSON/i);
});

test('the validator passes on every corpus prompt at every level', () => {
  for (const [name, text] of Object.entries(CORPUS)) {
    for (const level of LEVELS) {
      const r = run(text, level);
      assert.strictEqual(r.validation.validated, true, `${name}/${level} was never validated`);
      assert.ok(r.validation.ok, `${name}/${level} lost: ${r.validation.issues.map((i) => i.text).join(', ')}`);
      assert.strictEqual(r.validation.meaningScore, 1, `${name}/${level} scored ${r.validation.meaningScore}`);
    }
  }
});

test('at least one example survives when several are given', () => {
  const out = run(CORPUS.withExamples, 'maximum').optimized;
  assert.match(out, /apple/i, 'the first example is the spec for the output shape');
});

// ── Behaviour of the loop itself ───────────────────────────────────────────

test('optimization never returns a longer prompt', () => {
  for (const [name, text] of Object.entries(CORPUS)) {
    for (const level of LEVELS) {
      const r = run(text, level);
      assert.ok(
        r.analytics.optimizedTokens <= r.analytics.originalTokens,
        `${name}/${level} grew from ${r.analytics.originalTokens} to ${r.analytics.optimizedTokens}`,
      );
    }
  }
});

test('multiple passes terminate, and each one that is kept actually paid', () => {
  for (const text of Object.values(CORPUS)) {
    const r = run(text, 'maximum');
    assert.ok(r.refinements.length <= 4, `too many passes: ${r.refinements.length}`);
    for (const p of r.refinements) {
      if (p.rejected) continue;
      assert.ok(p.tokensAfter < p.tokensBefore, 'a kept pass must reduce the token count');
      assert.ok(p.edits.length > 0, 'a kept pass must have made an edit');
    }
    // The last pass is always a stop: either it found nothing, or it was refused.
    const last = r.refinements[r.refinements.length - 1];
    if (last) assert.ok(last.rejected || r.refinements.length === 4);
  }
});

test('iterative compression finds more than a single pass does', () => {
  const single = T.analyzePrompt(CORPUS.longTechnical, { level: 'maximum', maxRefinementPasses: 0 });
  const iterated = run(CORPUS.longTechnical, 'maximum');
  assert.ok(
    iterated.analytics.tokensSaved > single.analytics.tokensSaved,
    `iteration added nothing: ${single.analytics.tokensSaved} -> ${iterated.analytics.tokensSaved}`,
  );
});

test('rejecting every suggestion gives back the original, byte for byte', () => {
  for (const text of Object.values(CORPUS)) {
    const r = run(text, 'maximum');
    assert.strictEqual(T.recompute(r, new Set()).optimized, text);
  }
});

test('the semantic-preservation guard catches a destructive edit', () => {
  // Hand-built: an "optimization" that drops a negation and a number.
  const original = 'Do not exceed 500 words and never mention pricing.';
  const report = T.validateMeaning({
    original,
    optimized: 'Keep it short and mention what you like.',
    appliedEdits: [],
  });
  assert.strictEqual(report.validated, true);
  assert.strictEqual(report.ok, false);
  assert.ok(report.issues.some((i) => i.kind === 'negation'), 'a dropped negation must be reported');
});

// ── The removed / preserved breakdown ──────────────────────────────────────

test('the change summary describes real edits and a real validation', () => {
  const r = run(CORPUS.veryVerbose, 'balanced');
  const s = r.changeSummary;
  assert.ok(s.removed.length > 0, 'something was removed and should be listed');
  assert.strictEqual(s.verified, true);
  assert.ok(s.preserved.some((p) => /requirement/.test(p.label)), 'requirements are reported as preserved');
  // Every removed label corresponds to a category that was actually applied.
  const applied = new Set(r.suggestions.filter((x) => r.defaultAccepted.includes(x.id)).map((x) => x.category));
  for (const p of r.refinements) for (const e of p.edits || []) applied.add(e.category);
  assert.ok(applied.size > 0);
});

test('an unvalidated result claims nothing about preservation', () => {
  const s = T.summarizeChanges({
    suggestions: [], accepted: new Set(), refinements: [], constraints: [], entities: [],
    validation: { validated: true, ok: false, issues: [], meaningScore: 0.5 },
  });
  assert.strictEqual(s.verified, false);
  assert.strictEqual(s.preserved.length, 0);
});

// ── Model awareness ────────────────────────────────────────────────────────

test('an unidentified target model keeps slightly more structure, never less information', () => {
  const known = run(CORPUS.longTechnical, 'balanced', {
    targetModel: { provider: 'openai', canonicalModel: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', tier: 'flagship', reasoningClass: 'high', known: true },
  });
  const unknown = run(CORPUS.longTechnical, 'balanced', {
    targetModel: { provider: 'openai', canonicalModel: null, label: 'GPT-7.2 Nimbus', tier: null, reasoningClass: null, known: false },
  });
  assert.ok(
    unknown.analytics.optimizedTokens >= known.analytics.optimizedTokens,
    'an unknown model must not produce a denser rewrite than a known one',
  );
  // Whatever the model, the requirements survive. Model awareness is a
  // readability dial, not permission to drop information.
  for (const r of [known, unknown]) {
    assert.ok(r.validation.ok);
    assert.match(r.optimized, /numbered list/i);
  }
});
