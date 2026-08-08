// Reasoning / thinking detection, and live model + reasoning switching.
// ---------------------------------------------------------------------------
// Two claims are under test here and they are deliberately kept apart:
//
//   WHAT THE PAGE SHOWS     the raw label, reproduced exactly. Detection is
//                           allowed to find nothing, and "not exposed" is a
//                           real answer that must survive to the UI intact.
//
//   WHAT THAT MEANS         the normalized reasoning class the estimator
//                           reasons about. Derived, never displayed as if it
//                           were what the product said.
//
// Plus the behaviour that makes this feature worth having at all: switching
// model or reasoning mid-draft has to change the answer immediately, without a
// reload, without the popup closing, and without a second detector appearing.

const test = require('node:test');
const assert = require('node:assert');

const dom = require('./helpers/dom.js');
const FIX = require('./fixtures/providers.js');
const Registry = require('../lib/models/adapters/index.js');
const RSN = require('../lib/models/reasoning.js');
const OBS = require('../lib/models/observation.js');
const DET = require('../lib/models/detector.js');
const DISC = require('../lib/models/discovery.js');
const PRESENT = require('../lib/models/present.js');
const EST = require('../lib/estimator.js');

const domTest = dom.available ? test : test.skip;

function observe(html, url, provider) {
  const page = dom.createPage(html, { url });
  try {
    return Registry.byProvider(provider).readModelObservation(page.document, { url: page.window.location });
  } finally {
    page.restore();
  }
}

// ── Normalization ──────────────────────────────────────────────────────────

test('every documented reasoning label normalizes to a class', () => {
  const cases = {
    Auto: 'adaptive',
    Instant: 'minimal',
    Thinking: 'high',
    'Extended thinking': 'high',
    Low: 'standard',
    Medium: 'standard',
    High: 'high',
    Maximum: 'maximum',
    Max: 'maximum',
    xHigh: 'maximum',
    Pro: 'pro',
    'Deep Think': 'pro',
    Adaptive: 'adaptive',
  };
  for (const [label, expected] of Object.entries(cases)) {
    assert.strictEqual(RSN.classify(label), expected, label);
  }
  // Every class in the exported vocabulary is reachable from some label.
  const reached = new Set(Object.values(cases));
  for (const c of RSN.CLASSES) assert.ok(reached.has(c), `class "${c}" is unreachable`);
});

test('an unrecognised reasoning label produces null, never a default', () => {
  for (const label of ['', null, undefined, 'Highlight', 'Professional', 'Sol', 'unknown']) {
    assert.strictEqual(RSN.classify(label), null, JSON.stringify(label));
  }
  // "Highlight" contains "high" and must not match it.
  assert.strictEqual(RSN.readModeLabel('Highlight the key figures'), null);
});

test('the raw label and the normalized class are both kept, and never confused', () => {
  const { modeLabel, effortLabel } = RSN.splitLabel('Thinking · High');
  assert.strictEqual(modeLabel, 'Thinking');
  assert.strictEqual(effortLabel, 'High');
  const described = RSN.describe({ reasoningMode: 'high' }, 'Thinking · High');
  assert.strictEqual(described.reasoningModeLabel, 'Thinking');
  assert.strictEqual(described.reasoningEffortLabel, 'High');
  assert.strictEqual(described.reasoningClass, 'high');
  assert.strictEqual(RSN.displayLabel(described), 'Thinking · High');
});

test('the class vocabulary round-trips into the estimator vocabulary safely', () => {
  // Round-tripping may never REDUCE the assumed compute of an interaction.
  const RANK = { none: 0, low: 1, medium: 2, adaptive: 2, high: 3, xhigh: 4, max: 5, pro: 6, 'deep-think': 6 };
  for (const mode of Object.keys(RANK)) {
    const back = RSN.estimatorMode(RSN.classify(mode));
    assert.ok(back, mode);
    assert.ok(RANK[back] >= RANK[mode] - 1, `${mode} -> ${back} lost compute`);
  }
});

// ── ChatGPT ────────────────────────────────────────────────────────────────

domTest('ChatGPT thinking and effort are read from their own control', () => {
  const high = observe(FIX.CHATGPT_THINKING_HIGH, 'https://chatgpt.com/c/a', 'openai');
  assert.strictEqual(high.canonicalModel, 'gpt-5.6-sol', 'the model is still read from the picker');
  assert.strictEqual(high.reasoningMode, 'high');
  assert.strictEqual(high.reasoningSource, 'reasoning-control');
  assert.strictEqual(high.reasoningLabel, 'Thinking · High');

  const instant = observe(FIX.CHATGPT_INSTANT, 'https://chatgpt.com/c/b', 'openai');
  assert.strictEqual(instant.canonicalModel, 'gpt-5.6-luna');
  assert.strictEqual(instant.reasoningMode, 'none');
  assert.strictEqual(OBS.toDetectedModel(instant).reasoningClass, 'minimal');

  const pro = observe(FIX.CHATGPT_PRO, 'https://chatgpt.com/c/c', 'openai');
  assert.strictEqual(pro.reasoningMode, 'pro');
  assert.strictEqual(OBS.toDetectedModel(pro).reasoningClass, 'pro');
});

domTest('a selected effort row is read as effort, and never as the model', () => {
  const obs = observe(FIX.CHATGPT_EFFORT_MENU, 'https://chatgpt.com/c/d', 'openai');
  assert.strictEqual(obs.reasoningMode, 'max');
  assert.strictEqual(OBS.toDetectedModel(obs).reasoningClass, 'maximum');
  // The picker still names Terra. An effort row must not overwrite that.
  assert.strictEqual(obs.canonicalModel, 'gpt-5.6-terra');
});

domTest('a page with no reasoning control reports "not exposed", not a default', () => {
  const obs = observe(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc', 'openai');
  assert.strictEqual(obs.reasoningMode, null);
  assert.strictEqual(obs.reasoningLabel, null);
  assert.strictEqual(OBS.toDetectedModel(obs).reasoningClass, null);
  assert.match(PRESENT.reasoningLabel(obs), /not exposed/);
});

// ── Claude ─────────────────────────────────────────────────────────────────

domTest('Claude effort levels are detected, and vendor locks still win', () => {
  const low = observe(FIX.CLAUDE_EFFORT_LOW, 'https://claude.ai/chat/1', 'anthropic');
  assert.strictEqual(low.canonicalModel, 'claude-sonnet-5');
  assert.strictEqual(low.reasoningMode, 'low');
  assert.strictEqual(OBS.toDetectedModel(low).reasoningClass, 'standard');

  const high = observe(FIX.CLAUDE_PICKER, 'https://claude.ai/chat/2', 'anthropic');
  assert.strictEqual(high.canonicalModel, 'claude-opus-5');
  assert.strictEqual(high.reasoningMode, 'high');

  // Fable's adaptive thinking cannot be switched off, so a control reading
  // "Off" does NOT produce a no-reasoning observation.
  const fable = observe(FIX.CLAUDE_FABLE_ADAPTIVE, 'https://claude.ai/chat/3', 'anthropic');
  assert.strictEqual(fable.canonicalModel, 'claude-fable-5');
  assert.strictEqual(fable.reasoningMode, 'adaptive');
  assert.strictEqual(fable.reasoningLockedBy, 'model');
});

// ── Gemini ─────────────────────────────────────────────────────────────────

domTest('Gemini Deep Think is recorded as a mode on top of the model', () => {
  const obs = observe(FIX.GEMINI_DEEP_THINK_MODE, 'https://gemini.google.com/app/x', 'google');
  assert.strictEqual(obs.canonicalModel, 'gemini-3.1-pro', 'the underlying model is still Pro');
  assert.strictEqual(obs.reasoningMode, 'deep-think');
  assert.strictEqual(OBS.toDetectedModel(obs).reasoningClass, 'pro');
});

// ── Reasoning feeds the estimate ───────────────────────────────────────────

test('the same model at different reasoning levels does not get the same estimate', () => {
  const at = (reasoning) => EST.estimate({
    provider: 'openai', selectedModel: 'gpt-5.6-sol', reasoning, inputTokens: 400, outputTokens: 600,
  });
  const low = at('low');
  const max = at('max');
  assert.ok(
    max.energyWh.central > low.energyWh.central,
    `max (${max.energyWh.central}) must exceed low (${low.energyWh.central})`,
  );
  // …and it is a different family of priors, not the same number scaled.
  assert.notStrictEqual(max.profileId, low.profileId);
});

// ── The normalized record ──────────────────────────────────────────────────

test('DetectedModel keeps selection and effective routing apart', () => {
  const auto = OBS.toDetectedModel(OBS.emptyObservation({
    provider: 'openai', routing: 'auto', selectedLabel: 'Auto', source: 'picker-label',
  }));
  assert.strictEqual(auto.selectedMode, 'auto');
  assert.strictEqual(auto.canonicalModelId, null);
  assert.strictEqual(auto.effectiveModel, null, 'Auto must never be silently renamed to a model');
  assert.strictEqual(auto.product, 'chatgpt');

  const routed = OBS.toDetectedModel(OBS.emptyObservation({
    provider: 'openai', routing: 'auto', selectedLabel: 'Auto', effectiveModel: 'gpt-5.6-sol',
    source: 'response-metadata',
  }));
  assert.strictEqual(routed.selectedMode, 'auto', 'the selection is still Auto');
  assert.strictEqual(routed.effectiveModel, 'gpt-5.6-sol');
  assert.strictEqual(routed.canonicalModelId, null, 'the two fields never merge');
});

test('verified and confident are different questions', () => {
  const brandNew = OBS.toDetectedModel(OBS.emptyObservation({
    provider: 'openai', selectedLabel: 'GPT-7.2 Nimbus', source: 'picker-label', confidence: 0.3,
  }));
  // We are certain WHICH model is selected — the picker said so.
  assert.strictEqual(brandNew.verified, true);
  assert.strictEqual(brandNew.selectedLabel, 'GPT-7.2 Nimbus');
  assert.strictEqual(brandNew.unmapped, true);
  // …and honest that we do not know what it costs.
  assert.strictEqual(brandNew.estimateBasis, 'provider-fallback');

  const nothing = OBS.toDetectedModel(OBS.emptyObservation({ provider: 'openai' }));
  assert.strictEqual(nothing.verified, false);
});

test('the UI never hedges about a model the product named', () => {
  const label = PRESENT.pillLabel(OBS.emptyObservation({
    provider: 'openai', selectedLabel: 'GPT-7.2 Nimbus', source: 'picker-label',
  }));
  assert.strictEqual(label, 'GPT-7.2 Nimbus');
  for (const forbidden of [/probably/i, /maybe/i, /likely/i, /not sure/i, /unknown/i, /\?$/]) {
    assert.ok(!forbidden.test(label), `pill said "${label}"`);
  }
  // With reasoning exposed, both facts appear, in that order.
  assert.strictEqual(
    PRESENT.pillLabel(OBS.emptyObservation({
      provider: 'openai', canonicalModel: 'gpt-5.6-sol', reasoningMode: 'high', reasoningLabel: 'Thinking · High',
    })),
    'GPT-5.6 Sol · Thinking · High',
  );
  assert.strictEqual(
    PRESENT.pillLabel(OBS.emptyObservation({
      provider: 'anthropic', canonicalModel: 'claude-opus-5', reasoningMode: 'medium',
    })),
    'Claude Opus 5 · Standard reasoning',
  );
});

// ── Discovery ──────────────────────────────────────────────────────────────

test('an unknown model is recorded, and a known one is not', () => {
  const seen = [];
  const reg = DISC.createRegistry({ storage: null, log: (...a) => seen.push(a.join(' ')) });
  assert.ok(reg.record('openai', 'GPT-7.2 Nimbus'), 'a new tier is a discovery');
  assert.strictEqual(reg.record('openai', 'GPT-5.6 Sol'), null, 'a known model is not');
  // Configuration names are never recorded as models.
  assert.strictEqual(reg.record('anthropic', 'Fable 5 migration project'), null);
  assert.strictEqual(reg.record('google', 'Untitled chat'), null);
  assert.strictEqual(reg.record('openai', 'Delete'), null);
  assert.strictEqual(reg.size, 1);
  // Seeing it again updates the entry rather than adding another.
  reg.record('openai', 'GPT-7.2 Nimbus');
  assert.strictEqual(reg.size, 1);
  assert.strictEqual(reg.list()[0].count, 2);
  assert.ok(seen.some((line) => line.includes('GPT-7.2 Nimbus')), 'a discovery is logged, structured');
});

test('a discovered label is never mapped onto a similar known model', () => {
  const reg = DISC.createRegistry({ storage: null });
  reg.record('openai', 'GPT-5.7 Sol');
  const entry = reg.list()[0];
  assert.strictEqual(entry.label, 'GPT-5.7 Sol');
  // The registry stores it; it does not resolve it.
  assert.ok(!('canonicalModel' in entry));
});

// ── Live switching ─────────────────────────────────────────────────────────

/** Manual clock, so throttles and debounces run without waiting. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    api: {
      setTimeout(fn, ms) { const id = ++seq; pending.set(id, { at: now + (ms || 0), fn, every: 0 }); return id; },
      clearTimeout(id) { pending.delete(id); },
      setInterval(fn, ms) { const id = ++seq; pending.set(id, { at: now + (ms || 0), fn, every: ms || 1 }); return id; },
      clearInterval(id) { pending.delete(id); },
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...pending.entries()]) {
        if (t.at > now) continue;
        if (t.every) t.at = now + t.every; else pending.delete(id);
        t.fn();
      }
    },
  };
}

domTest('switching Sol -> Terra -> Luna -> Sol is detected every time, with no reload', async () => {
  const page = dom.createPage(FIX.CHATGPT_MENU_CLOSED, { url: 'https://chatgpt.com/c/abc' });
  const clock = fakeTimers();
  const changes = [];
  const detector = DET.create({
    adapter: Registry.byProvider('openai'),
    document: page.document,
    window: page.window,
    timers: clock.api,
    onChange: (current, previous) => changes.push([previous && previous.canonicalModel, current.canonicalModel]),
  });
  try {
    detector.start();
    assert.strictEqual(detector.current.canonicalModel, 'gpt-5.6-sol');
    const button = page.document.querySelector('[data-testid="model-switcher-dropdown-button"]');
    const startGeneration = detector.generation;

    for (const [label, id] of [['GPT-5.6 Terra', 'gpt-5.6-terra'], ['GPT-5.6 Luna', 'gpt-5.6-luna'], ['GPT-5.6 Sol', 'gpt-5.6-sol']]) {
      button.textContent = label;
      await page.tick(0);
      clock.advance(200);   // cheap scan
      clock.advance(500);   // full recalculation
      assert.strictEqual(detector.current.canonicalModel, id, `switch to ${label}`);
    }

    assert.strictEqual(changes.length, 3, 'each switch fires exactly once');
    assert.deepStrictEqual(changes.map((c) => c[1]), ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol']);
    // The generation counter advanced once per change: that is the primitive
    // that makes an in-flight optimization for the old model discardable.
    assert.strictEqual(detector.generation, startGeneration + 3);
    assert.ok(!detector.isCurrentGeneration(startGeneration), 'stale work is invalidated');
  } finally {
    detector.destroy();
    page.restore();
  }
});

domTest('a reasoning switch fires a change on its own, without the model moving', async () => {
  const page = dom.createPage(FIX.CHATGPT_THINKING_HIGH, { url: 'https://chatgpt.com/c/a' });
  const clock = fakeTimers();
  const changes = [];
  const detector = DET.create({
    adapter: Registry.byProvider('openai'),
    document: page.document,
    window: page.window,
    timers: clock.api,
    onChange: (current) => changes.push(current.reasoningMode),
  });
  try {
    detector.start();
    assert.strictEqual(detector.current.reasoningMode, 'high');
    assert.strictEqual(detector.current.canonicalModel, 'gpt-5.6-sol');

    page.document.querySelector('[data-testid="reasoning-effort-button"]').textContent = 'Instant';
    await page.tick(0);
    clock.advance(200);
    clock.advance(500);

    assert.deepStrictEqual(changes, ['none']);
    assert.strictEqual(detector.current.reasoningMode, 'none');
    assert.strictEqual(detector.current.canonicalModel, 'gpt-5.6-sol', 'the model did not change');
  } finally {
    detector.destroy();
    page.restore();
  }
});

domTest('a stale cached observation never survives a change in the visible UI', async () => {
  const page = dom.createPage(FIX.CHATGPT_MENU_CLOSED, { url: 'https://chatgpt.com/c/abc' });
  const clock = fakeTimers();
  const detector = DET.create({
    adapter: Registry.byProvider('openai'),
    document: page.document, window: page.window, timers: clock.api,
  });
  try {
    detector.start();
    const stale = detector.current;
    assert.strictEqual(stale.canonicalModel, 'gpt-5.6-sol');

    page.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'GPT-5.6 Luna';
    await page.tick(0);
    clock.advance(200);
    clock.advance(500);

    assert.strictEqual(detector.current.canonicalModel, 'gpt-5.6-luna');
    assert.strictEqual(detector.previous.canonicalModel, 'gpt-5.6-sol', 'the old value is kept as history, not as truth');
    assert.notStrictEqual(detector.current, stale);
  } finally {
    detector.destroy();
    page.restore();
  }
});

domTest('a composer remount rebinds the observer instead of stacking a second one', async () => {
  const page = dom.createPage(FIX.CHATGPT_MENU_CLOSED, { url: 'https://chatgpt.com/c/abc' });
  const clock = fakeTimers();
  let changes = 0;
  const detector = DET.create({
    adapter: Registry.byProvider('openai'),
    document: page.document, window: page.window, timers: clock.api,
    onChange: () => { changes += 1; },
  });
  try {
    detector.start();
    const before = detector.observedRoots.length;
    assert.ok(before > 0);

    // React replaces the whole header subtree, model picker included.
    const header = page.document.getElementById('page-header');
    const replacement = page.document.createElement('div');
    replacement.id = 'page-header';
    replacement.innerHTML = '<button data-testid="model-switcher-dropdown-button">GPT-5.6 Terra</button>';
    header.parentNode.replaceChild(replacement, header);
    await page.tick(0);
    clock.advance(200);
    clock.advance(500);

    assert.strictEqual(detector.current.canonicalModel, 'gpt-5.6-terra', 'detection survived the remount');
    assert.strictEqual(changes, 1, 'exactly one change was reported, not one per stacked observer');
  } finally {
    detector.destroy();
    page.restore();
  }
});

domTest('SPA navigation to a new conversation keeps detection working', async () => {
  const page = dom.createPage(FIX.CHATGPT_MENU_CLOSED, { url: 'https://chatgpt.com/c/abc' });
  const clock = fakeTimers();
  const detector = DET.create({
    adapter: Registry.byProvider('openai'),
    document: page.document, window: page.window, timers: clock.api,
  });
  try {
    detector.start();
    assert.strictEqual(detector.current.conversationKey, 'openai:abc');

    page.window.history.pushState({}, '', '/c/def');
    clock.advance(1200);   // the route poll
    clock.advance(200);
    clock.advance(500);

    assert.strictEqual(detector.current.conversationKey, 'openai:def');
    assert.strictEqual(detector.current.canonicalModel, 'gpt-5.6-sol', 'the model is still read after navigating');
  } finally {
    detector.destroy();
    page.restore();
  }
});

domTest('detection does not poll the DOM', async () => {
  const page = dom.createPage(FIX.CHATGPT_MENU_CLOSED, { url: 'https://chatgpt.com/c/abc' });
  const clock = fakeTimers();
  let queries = 0;
  const original = page.document.querySelectorAll.bind(page.document);
  page.document.querySelectorAll = (sel) => { queries += 1; return original(sel); };
  const detector = DET.create({
    adapter: Registry.byProvider('openai'),
    document: page.document, window: page.window, timers: clock.api,
  });
  try {
    detector.start();
    const afterStart = queries;
    // Ten seconds of an idle page. Only the route check should tick, and it
    // reads one string rather than querying the document.
    clock.advance(10000);
    assert.strictEqual(queries, afterStart, `an idle page cost ${queries - afterStart} extra DOM queries`);
  } finally {
    page.document.querySelectorAll = original;
    detector.destroy();
    page.restore();
  }
});
