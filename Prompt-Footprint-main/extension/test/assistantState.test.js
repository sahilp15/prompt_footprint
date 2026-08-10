const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/assistantState.js');

// The assistant's decisions, tested without a browser: which state applies,
// whether an optimization is worth offering, the typing debounce, the guard that
// discards stale results, and how preferences map onto pf_config.

const ready = {
  engineReady: true,
  composerFound: true,
  text: 'Write me a reasonably long prompt so the assistant has something to say about it.',
  online: true,
  mode: 'local',
};

// ── State selection ────────────────────────────────────────────────────────

test('every state the UI declares is reachable from nextState', () => {
  const cases = {
    unavailable: { ...ready, engineReady: false },
    unsupported: { ...ready, composerFound: false },
    empty: { ...ready, text: 'too short' },
    replaced: { ...ready, replaced: true },
    undo: { ...ready, canUndo: true },
    failed: { ...ready, error: 'boom' },
    offline: { ...ready, mode: 'enhanced', online: false },
    analyzing: { ...ready, analyzing: true },
    typing: { ...ready, typing: true },
    available: { ...ready, analytics: { tokensSaved: 40, percentReduction: 30 } },
    // "Already concise" is now a claim about the PROMPT, made by the engine, not
    // an inference from a small saving. Below the offer floor with no assessment
    // saying the prompt is tight, the honest answer is "marginal".
    marginal: { ...ready, analytics: { tokensSaved: 1, percentReduction: 1 } },
    concise: {
      ...ready,
      analytics: { tokensSaved: 0, percentReduction: 0 },
      concision: { concise: true, checks: {}, reasons: [] },
    },
  };
  for (const [expected, input] of Object.entries(cases)) {
    assert.strictEqual(S.nextState(input), expected, `expected ${expected}`);
  }
  // …and the list the UI renders from covers exactly those states.
  for (const state of Object.keys(cases)) assert.ok(S.STATES.includes(state), state);
});

test('a missing engine outranks everything else', () => {
  assert.strictEqual(
    S.nextState({ ...ready, engineReady: false, composerFound: false, analyzing: true }),
    'unavailable',
  );
});

test('an empty or barely-started composer shows nothing at all', () => {
  assert.strictEqual(S.nextState({ ...ready, text: '' }), 'empty');
  assert.strictEqual(S.nextState({ ...ready, text: '   \n  ' }), 'empty');
  assert.strictEqual(S.nextState({ ...ready, text: 'hi' }), 'empty');
  assert.strictEqual(S.isIndicatorVisible('empty'), false);
  assert.strictEqual(S.isIndicatorVisible('unsupported'), false);
  assert.strictEqual(S.isIndicatorVisible('available'), true);
});

test('being offline only matters in enhanced mode', () => {
  assert.strictEqual(S.nextState({ ...ready, online: false, analyzing: true }), 'analyzing');
  assert.strictEqual(S.nextState({ ...ready, mode: 'enhanced', online: false }), 'offline');
});

test('a result that failed validation is never presented as available', () => {
  const input = {
    ...ready,
    analytics: { tokensSaved: 90, percentReduction: 60 },
    validation: { ok: false, issues: [{ severity: 'critical', text: 'do not' }] },
  };
  // Not offered — and NOT called concise either, because a validation failure is
  // a statement about the optimizer's output, not about the user's prompt.
  assert.strictEqual(S.nextState(input), 'marginal');
});

// ── Worth offering ─────────────────────────────────────────────────────────

test('a real saving is offered, and rounding is not', () => {
  assert.strictEqual(S.isWorthOffering({ tokensSaved: 40, percentReduction: 30 }), true);
  // 2 tokens off a short prompt is a real reduction and is now offered. The old
  // floor (4 tokens AND 4%) meant a fifth of a 25-token prompt could disappear
  // without the assistant mentioning it.
  assert.strictEqual(S.isWorthOffering({ tokensSaved: 2, percentReduction: 8 }), true);
  assert.strictEqual(S.isWorthOffering({ tokensSaved: 1, percentReduction: 40 }), false);
  assert.strictEqual(S.isWorthOffering({ tokensSaved: 40, percentReduction: 1 }), false);
  assert.strictEqual(S.isWorthOffering({ tokensSaved: 0, percentReduction: 0 }), false);
  assert.strictEqual(S.isWorthOffering(null), false);
});

test('"already concise" is only ever said when the engine assessed it', () => {
  const small = { tokensSaved: 0, percentReduction: 0 };
  // No assessment at all: the claim is not made.
  assert.strictEqual(S.nextState({ ...ready, analytics: small }), 'marginal');
  assert.strictEqual(S.isGenuinelyConcise(undefined), false);
  assert.strictEqual(S.isGenuinelyConcise(null), false);
  // An assessment that found outstanding opportunities: still not made, even
  // though the applied saving is zero. This is the exact bug being fixed —
  // "nothing was applied" was being reported as "nothing was there".
  assert.strictEqual(
    S.nextState({ ...ready, analytics: small, concision: { concise: false, reasons: ['3 filler phrases'] } }),
    'marginal',
  );
  assert.strictEqual(
    S.nextState({ ...ready, analytics: small, concision: { concise: true, reasons: [] } }),
    'concise',
  );
});

test('the concise claim does not depend on prompt length', () => {
  // A 25-token prompt CAN be concise, and a 1,000-token one can fail to be.
  const tiny = { tokensSaved: 0, percentReduction: 0, originalTokens: 25 };
  const huge = { tokensSaved: 1, percentReduction: 0.1, originalTokens: 1000 };
  assert.strictEqual(S.nextState({ ...ready, analytics: tiny, concision: { concise: true } }), 'concise');
  assert.strictEqual(S.nextState({ ...ready, analytics: huge, concision: { concise: false } }), 'marginal');
});

// ── Debounce ───────────────────────────────────────────────────────────────

test('analysis runs once per typing pause, not once per keystroke', () => {
  let now = 0;
  const queue = [];
  const timers = {
    setTimeout: (fn, ms) => { const id = queue.length; queue.push({ id, fn, at: now + ms }); return id; },
    clearTimeout: (id) => { const t = queue.find((x) => x.id === id); if (t) t.cancelled = true; },
  };
  const advance = (ms) => {
    now += ms;
    queue.filter((t) => !t.cancelled && !t.done && t.at <= now).forEach((t) => { t.done = true; t.fn(); });
  };

  let runs = 0;
  const debouncer = S.createDebouncer(() => { runs += 1; }, 600, timers);

  for (let i = 0; i < 20; i += 1) { debouncer.schedule(); advance(50); }  // 1s of typing
  assert.strictEqual(runs, 0, 'must not fire mid-burst');
  advance(600);
  assert.strictEqual(runs, 1, 'exactly one run for the whole burst');

  debouncer.schedule();
  debouncer.cancel();
  advance(1000);
  assert.strictEqual(runs, 1, 'a cancelled analysis never runs');
});

// ── Stale-request cancellation ─────────────────────────────────────────────

test('a result whose prompt has since changed is discarded', () => {
  const guard = S.createRequestGuard();
  const first = guard.issue();
  assert.strictEqual(guard.isCurrent(first), true);

  const second = guard.issue();               // the user typed again
  assert.strictEqual(guard.isCurrent(first), false, 'the older request is stale');
  assert.strictEqual(guard.isCurrent(second), true);

  guard.cancelAll();                          // e.g. a navigation
  assert.strictEqual(guard.isCurrent(second), false);
});

// ── Settings ───────────────────────────────────────────────────────────────

test('defaults apply to an empty config', () => {
  assert.deepStrictEqual(S.readSettings({}), S.DEFAULTS);
  assert.deepStrictEqual(S.readSettings(null), S.DEFAULTS);
});

test('stored preferences are read back, and nonsense falls back to defaults', () => {
  const s = S.readSettings({
    writingChecksEnabled: false,
    assistantLevel: 'maximum',
    assistantAutoAnalyze: false,
    assistantShowImpact: false,
    assistantAnimations: false,
  });
  assert.deepStrictEqual(s, {
    enabled: false, level: 'maximum', autoAnalyze: false,
    showImpact: false, mode: 'local', animations: false, debugPanel: false,
  });
  assert.strictEqual(S.readSettings({ assistantLevel: 'nuclear' }).level, 'balanced');
  // The debug panel is opt-in, and only an explicit `true` opts in.
  assert.strictEqual(S.readSettings({ assistantDebugPanel: 'yes' }).debugPanel, false);
  assert.strictEqual(S.readSettings({ assistantDebugPanel: true }).debugPanel, true);
});

test('enhanced mode requires BOTH the mode choice and the cloud opt-in', () => {
  // Either flag alone must leave the assistant local — this is the setting that
  // decides whether a draft prompt can leave the device.
  assert.strictEqual(S.readSettings({ assistantMode: 'enhanced' }).mode, 'local');
  assert.strictEqual(S.readSettings({ cloudAnalysisEnabled: true }).mode, 'local');
  assert.strictEqual(
    S.readSettings({ assistantMode: 'enhanced', cloudAnalysisEnabled: true }).mode,
    'enhanced',
  );
});

test('settingsPatch writes only known keys with valid values', () => {
  assert.deepStrictEqual(
    S.settingsPatch({ enabled: false, level: 'light', autoAnalyze: true }),
    { writingChecksEnabled: false, assistantLevel: 'light', assistantAutoAnalyze: true },
  );
  assert.deepStrictEqual(S.settingsPatch({ level: 'extreme', mode: 'psychic' }), {});
  assert.deepStrictEqual(S.settingsPatch({ geminiApiKey: 'secret' }), {});
  assert.deepStrictEqual(S.settingsPatch(null), {});
});

test('reset restores every assistant preference to its default', () => {
  assert.deepStrictEqual(S.readSettings(S.resetPatch()), S.DEFAULTS);
});
