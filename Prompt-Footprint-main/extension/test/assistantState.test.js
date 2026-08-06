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
    concise: { ...ready, analytics: { tokensSaved: 1, percentReduction: 1 } },
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
  assert.strictEqual(S.nextState(input), 'concise');
});

// ── Worth offering ─────────────────────────────────────────────────────────

test('only a meaningful saving is worth interrupting someone for', () => {
  assert.strictEqual(S.isWorthOffering({ tokensSaved: 40, percentReduction: 30 }), true);
  assert.strictEqual(S.isWorthOffering({ tokensSaved: 2, percentReduction: 40 }), false);
  assert.strictEqual(S.isWorthOffering({ tokensSaved: 40, percentReduction: 1 }), false);
  assert.strictEqual(S.isWorthOffering({ tokensSaved: 0, percentReduction: 0 }), false);
  assert.strictEqual(S.isWorthOffering(null), false);
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
    showImpact: false, mode: 'local', animations: false,
  });
  assert.strictEqual(S.readSettings({ assistantLevel: 'nuclear' }).level, 'balanced');
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
