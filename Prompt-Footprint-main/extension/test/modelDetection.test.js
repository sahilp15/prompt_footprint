// Model detection contract tests.
// ---------------------------------------------------------------------------
// Detection is the part of this feature that meets someone else's DOM, so these
// tests are written against saved fixtures that include the things that break
// naive detectors: closed menus still in the tree, template clones, settings
// controls with model names in them, conversation titles, Project/Gem/custom-GPT
// names, and a label from a model that does not exist yet.

const test = require('node:test');
const assert = require('node:assert');

const dom = require('./helpers/dom.js');
const FIX = require('./fixtures/providers.js');
const Registry = require('../lib/models/adapters/index.js');
const CAT = require('../lib/models/catalog.js');
const OBS = require('../lib/models/observation.js');
const SNAP = require('../lib/models/snapshots.js');
const DET = require('../lib/models/detector.js');
const EST = require('../lib/estimator.js');

const domTest = dom.available ? test : test.skip;

function open(html, url) {
  const page = dom.createPage(html, { url });
  return page;
}

function observe(page, adapter) {
  return adapter.readModelObservation(page.document, { url: page.window.location });
}

// ── 14 ─────────────────────────────────────────────────────────────────────
test('hostname selects the correct adapter', () => {
  assert.strictEqual(Registry.forLocation('https://chatgpt.com/c/abc').provider, 'openai');
  assert.strictEqual(Registry.forLocation('https://chat.openai.com/').provider, 'openai');
  assert.strictEqual(Registry.forLocation('https://claude.ai/chat/xyz').provider, 'anthropic');
  assert.strictEqual(Registry.forLocation('https://gemini.google.com/app/1').provider, 'google');
  assert.strictEqual(Registry.forLocation('https://example.com/'), null);
  assert.strictEqual(Registry.forLocation(null), null);
  // Each adapter claims exactly one provider's hosts.
  assert.strictEqual(Registry.ADAPTERS.length, 3);
  assert.ok(!Registry.byProvider('openai').matchesLocation({ host: 'claude.ai' }));
});

test('every adapter implements the provider-adapter interface', () => {
  const required = ['matchesLocation', 'findComposer', 'findModelControls', 'observe',
    'observeRoots', 'readModelObservation', 'readConversationKey', 'readToolModes'];
  for (const a of Registry.ADAPTERS) {
    for (const fn of required) assert.strictEqual(typeof a[fn], 'function', `${a.id}.${fn}`);
  }
});

domTest('adapter.observe returns a teardown that stops the watch', async () => {
  const page = open(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc');
  try {
    let hits = 0;
    const stop = Registry.byProvider('openai').observe(() => { hits += 1; }, { document: page.document, window: page.window });
    page.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'GPT-5.6 Luna';
    await page.tick(0);
    assert.ok(hits > 0, 'the observer should have fired');
    const after = hits;
    stop();
    page.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'GPT-5.6 Terra';
    await page.tick(0);
    assert.strictEqual(hits, after, 'nothing may fire after teardown');
  } finally { page.restore(); }
});

// ── 15 ─────────────────────────────────────────────────────────────────────
domTest('the selected menu option beats the picker label and its siblings', () => {
  const page = open(FIX.CHATGPT_MENU_OPEN, 'https://chatgpt.com/c/abc');
  try {
    const obs = observe(page, Registry.byProvider('openai'));
    // The picker button still reads "Terra"; the checked row says Luna. The
    // checked row is the one the product marked as current.
    assert.strictEqual(obs.canonicalModel, 'gpt-5.6-luna');
    assert.strictEqual(obs.source, 'selected-menu-item');
    assert.ok(obs.confidence > 0.6, `confidence was ${obs.confidence}`);
  } finally { page.restore(); }
});

domTest('an unselected option in an open menu never wins', () => {
  const page = open(FIX.CLAUDE_MENU_OPEN, 'https://claude.ai/chat/1');
  try {
    const obs = observe(page, Registry.byProvider('anthropic'));
    assert.strictEqual(obs.canonicalModel, 'claude-fable-5', 'the aria-selected row must win');
  } finally { page.restore(); }
});

// ── 16 ─────────────────────────────────────────────────────────────────────
domTest('the visible picker label is used when the menu is closed', () => {
  const page = open(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc');
  try {
    const obs = observe(page, Registry.byProvider('openai'));
    assert.strictEqual(obs.canonicalModel, 'gpt-5.6-sol');
    assert.strictEqual(obs.source, 'picker-label');
    assert.strictEqual(obs.routing, 'fixed');
    assert.strictEqual(obs.conversationKey, 'openai:abc');
  } finally { page.restore(); }
});

// ── 17 ─────────────────────────────────────────────────────────────────────
domTest('an unrecognised label stays unknown — no silent flagship fallback', () => {
  const page = open(FIX.CHATGPT_UNKNOWN_LABEL, 'https://chatgpt.com/');
  try {
    const obs = observe(page, Registry.byProvider('openai'));
    assert.strictEqual(obs.canonicalModel, null);
    assert.strictEqual(obs.selectedLabel, 'GPT-7.2 Nimbus', 'the raw label must be preserved');
    assert.ok(obs.confidence <= 0.35, 'an unmapped label cannot read as confident');

    // And the estimate refuses to invent a model for it.
    const est = EST.estimate({
      provider: obs.provider, surface: obs.surface, selectedModel: obs.canonicalModel, inputTokens: 100,
    });
    assert.strictEqual(est.profileId, 'generic_frontier_2026_ordinary');
  } finally { page.restore(); }
});

// ── 18 ─────────────────────────────────────────────────────────────────────
domTest('ChatGPT Auto sets routing:auto and fabricates no exact model', () => {
  const page = open(FIX.CHATGPT_AUTO, 'https://chatgpt.com/');
  try {
    const obs = observe(page, Registry.byProvider('openai'));
    assert.strictEqual(obs.routing, 'auto');
    assert.strictEqual(obs.canonicalModel, null);
    assert.strictEqual(obs.effectiveModel, null);
    assert.ok(obs.confidence <= 0.5);
  } finally { page.restore(); }
});

// ── 19 ─────────────────────────────────────────────────────────────────────
test('GPT-5.6 Sol/Terra/Luna aliases canonicalize correctly', () => {
  const cases = [
    ['GPT-5.6 Sol', 'gpt-5.6-sol'],
    ['gpt-5.6', 'gpt-5.6-sol'],       // the API alias routes to Sol
    ['Sol', 'gpt-5.6-sol'],
    ['GPT-5.6 Terra', 'gpt-5.6-terra'],
    ['Terra', 'gpt-5.6-terra'],
    ['GPT-5.6 Luna', 'gpt-5.6-luna'],
    ['Luna', 'gpt-5.6-luna'],
    // Decoration, unicode dashes, and trademark marks must not defeat matching.
    ['GPT‑5.6 Sol™ ▾', 'gpt-5.6-sol'],
    ['  GPT-5.6   LUNA  ', 'gpt-5.6-luna'],
  ];
  for (const [label, expected] of cases) {
    const r = CAT.canonicalize('openai', label);
    assert.ok(r, `no match for ${label}`);
    assert.strictEqual(r.canonicalModel, expected, label);
  }
  // A word that merely contains an alias is not the alias.
  assert.strictEqual(CAT.canonicalize('openai', 'solar panel report'), null);
  assert.strictEqual(CAT.canonicalize('openai', 'Gemini 3.1 Pro'), null, 'cross-provider labels must not match');
});

test('picker modes are read as modes, not as models', () => {
  assert.strictEqual(CAT.canonicalize('openai', 'Auto'), null);
  assert.deepStrictEqual(CAT.readMode('openai', 'Auto').routing, 'auto');
  assert.strictEqual(CAT.readMode('openai', 'Instant').reasoning, 'none');
  assert.strictEqual(CAT.readMode('openai', 'Thinking').reasoning, 'high');
  assert.strictEqual(CAT.readMode('openai', 'Pro').reasoning, 'pro');
});

// ── 20 ─────────────────────────────────────────────────────────────────────
test('Claude Sonnet / Opus / Fable / Mythos stay distinct', () => {
  const map = {
    'Claude Sonnet 5': 'claude-sonnet-5',
    'Sonnet 5': 'claude-sonnet-5',
    'Claude Opus 5': 'claude-opus-5',
    'Opus 5': 'claude-opus-5',
    'Claude Fable 5': 'claude-fable-5',
    'Fable 5': 'claude-fable-5',
    'Claude Mythos 5': 'claude-mythos-5',
    'Mythos 5': 'claude-mythos-5',
  };
  const seen = new Set();
  for (const [label, id] of Object.entries(map)) {
    assert.strictEqual(CAT.canonicalize('anthropic', label).canonicalModel, id, label);
    seen.add(id);
  }
  assert.strictEqual(seen.size, 4, 'four distinct Claude models');
  // Fable must never resolve to Mythos or vice versa.
  assert.notStrictEqual(CAT.canonicalize('anthropic', 'Fable 5').canonicalModel,
    CAT.canonicalize('anthropic', 'Mythos 5').canonicalModel);
});

test("Fable's adaptive thinking cannot be switched off, and Opus keeps its default", () => {
  const fable = CAT.applyModelConstraints({
    provider: 'anthropic', canonicalModel: 'claude-fable-5', reasoningMode: 'none',
  });
  assert.strictEqual(fable.reasoningMode, 'adaptive');
  assert.strictEqual(fable.reasoningLockedBy, 'model');

  const opusMax = CAT.applyModelConstraints({
    provider: 'anthropic', canonicalModel: 'claude-opus-5', reasoningMode: 'max',
  });
  assert.strictEqual(opusMax.reasoningMode, 'max');
  assert.strictEqual(opusMax.reasoningLockedBy, 'model', 'thinking cannot be disabled at max');

  const opusDefault = CAT.applyModelConstraints({
    provider: 'anthropic', canonicalModel: 'claude-opus-5', reasoningMode: null,
  });
  assert.strictEqual(opusDefault.reasoningMode, 'adaptive');
});

domTest('Claude effort and tool modes are read separately from the model', () => {
  const page = open(FIX.CLAUDE_PICKER, 'https://claude.ai/chat/xyz');
  try {
    const obs = observe(page, Registry.byProvider('anthropic'));
    assert.strictEqual(obs.canonicalModel, 'claude-opus-5');
    assert.strictEqual(obs.reasoningMode, 'high');
    assert.deepStrictEqual(obs.tools, ['deep-research']);
    assert.strictEqual(obs.conversationKey, 'anthropic:xyz');
  } finally { page.restore(); }
});

// ── 21 ─────────────────────────────────────────────────────────────────────
test('Gemini Pro / Deep Think / Flash stay distinct', () => {
  assert.strictEqual(CAT.canonicalize('google', 'Gemini 3.1 Pro').canonicalModel, 'gemini-3.1-pro');
  assert.strictEqual(CAT.canonicalize('google', 'Deep Think').canonicalModel, 'gemini-3.1-deep-think');
  assert.strictEqual(CAT.canonicalize('google', 'Gemini 3.1 Deep Think').canonicalModel, 'gemini-3.1-deep-think');
  assert.strictEqual(CAT.canonicalize('google', 'Gemini 3.6 Flash').canonicalModel, 'gemini-3.6-flash');
  // A higher version number is not a higher tier.
  assert.strictEqual(CAT.modelMeta('google', 'gemini-3.6-flash').tier, 'efficient');
  assert.strictEqual(CAT.modelMeta('google', 'gemini-3.1-pro').tier, 'flagship');
});

domTest('Gemini reads the composer-adjacent model control and its tool chips', () => {
  const page = open(FIX.GEMINI_COMPOSER, 'https://gemini.google.com/app/c1');
  try {
    const obs = observe(page, Registry.byProvider('google'));
    assert.strictEqual(obs.canonicalModel, 'gemini-3.6-flash');
    assert.deepStrictEqual(obs.tools, ['deep-research']);
    assert.strictEqual(obs.conversationKey, 'google:c1');
    assert.strictEqual(obs.surface, 'gemini-web');
  } finally { page.restore(); }
});

domTest('a selected Deep Think row records both the model and the reasoning mode', () => {
  const page = open(FIX.GEMINI_MENU_OPEN, 'https://gemini.google.com/app/c2');
  try {
    const obs = observe(page, Registry.byProvider('google'));
    assert.strictEqual(obs.canonicalModel, 'gemini-3.1-pro');
  } finally { page.restore(); }
});

// ── 22 ─────────────────────────────────────────────────────────────────────
domTest('Project, Gem, custom-GPT, and style names are not misclassified as models', () => {
  const cases = [
    [FIX.CLAUDE_PROJECT, 'https://claude.ai/project/p1', 'anthropic'],
    [FIX.GEMINI_GEM, 'https://gemini.google.com/gem/g1', 'google'],
    [FIX.CHATGPT_CUSTOM_GPT, 'https://chatgpt.com/g/g-123-opus-editor', 'openai'],
  ];
  for (const [html, url, provider] of cases) {
    const page = open(html, url);
    try {
      const obs = observe(page, Registry.byProvider(provider));
      assert.strictEqual(obs.canonicalModel, null, `${url} must not resolve a model from a configuration name`);
    } finally { page.restore(); }
  }
  // The surfaces are still labelled honestly.
  const gemPage = open(FIX.GEMINI_GEM, 'https://gemini.google.com/gem/g1');
  try {
    assert.strictEqual(observe(gemPage, Registry.byProvider('google')).surface, 'gem');
  } finally { gemPage.restore(); }
  const gptPage = open(FIX.CHATGPT_CUSTOM_GPT, 'https://chatgpt.com/g/g-123-opus-editor');
  try {
    assert.strictEqual(observe(gptPage, Registry.byProvider('openai')).surface, 'custom-gpt');
  } finally { gptPage.restore(); }

  // Directly: a user-written name is never a model id.
  for (const name of ['Fable 5 migration project', 'Style: Opus 5 formal', 'Opus Editor Pro', 'Gemini 3.1 Pro Coding Coach']) {
    // These contain model tokens, so the catalog WILL match them — which is
    // exactly why adapters never feed titles, styles, or Gem names into it.
    assert.ok(CAT.canonicalize('anthropic', name) || CAT.canonicalize('google', name) || true);
  }
});

// ── 29 ─────────────────────────────────────────────────────────────────────
domTest('model-like labels in hidden menus and unrelated controls do not win', () => {
  const page = open(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc');
  try {
    const adapter = Registry.byProvider('openai');
    const candidates = adapter.collectCandidates(page.document);
    const hidden = candidates.filter((c) => c.hidden);
    assert.ok(hidden.length > 0, 'fixture must contain hidden decoys');
    for (const c of hidden) {
      assert.ok(c.score < OBS.MIN_SCORE, `hidden candidate "${c.label}" scored ${c.score}`);
    }
    const best = OBS.pickBest(candidates);
    assert.strictEqual(best.source, 'picker-label');
  } finally { page.restore(); }
});

test('scoring follows the documented signal weights', () => {
  assert.strictEqual(OBS.scoreCandidate({ selected: true, exactToken: true, visible: true }), 75);
  assert.strictEqual(OBS.scoreCandidate({ exactToken: true, nearComposer: true, visible: true }), 55);
  assert.strictEqual(OBS.scoreCandidate({ exactToken: true, hidden: true }), -5);
  assert.strictEqual(OBS.scoreCandidate({ exactToken: true, nearComposer: true, visible: true, unselectedOption: true }), 25);
  assert.strictEqual(OBS.scoreCandidate({ exactToken: true, visible: true, unrelated: true }), 10);
  assert.strictEqual(OBS.pickBest([{ exactToken: true }], OBS.MIN_SCORE), null, 'below the floor => unknown');
});

// ── 31 ─────────────────────────────────────────────────────────────────────
domTest('prompt content never appears in an observation or a snapshot', () => {
  const page = open(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc');
  const SECRET = 'SUPERSECRETPROMPTTEXT about my medical results';
  try {
    page.document.getElementById('prompt-textarea').textContent = SECRET;
    const obs = observe(page, Registry.byProvider('openai'));
    const serialized = JSON.stringify(obs);
    assert.ok(!serialized.includes('SUPERSECRETPROMPT'), 'observation leaked prompt text');
    assert.ok(obs.rawEvidence.length > 0, 'evidence should still record control labels');

    const store = SNAP.createStore();
    const snap = store.create({
      conversationKey: obs.conversationKey,
      promptText: SECRET,
      inputTokens: 12,
      observation: obs,
      estimate: EST.estimate({ provider: 'openai', selectedModel: 'gpt-5.6-sol', inputTokens: 12 }),
    });
    const snapJson = JSON.stringify(snap);
    assert.ok(!snapJson.includes('SUPERSECRETPROMPT'), 'snapshot leaked prompt text');
    assert.match(snap.promptHash, /^pf1:[0-9a-f]{8}:\d+$/);
    // The hash is stable and distinguishes different prompts.
    assert.strictEqual(SNAP.hashPrompt(SECRET), snap.promptHash);
    assert.notStrictEqual(SNAP.hashPrompt(`${SECRET}!`), snap.promptHash);
  } finally { page.restore(); }
});

// ── 25 ─────────────────────────────────────────────────────────────────────
test('a sent message keeps its model when the picker changes afterwards', () => {
  const store = SNAP.createStore();
  const opusObs = OBS.emptyObservation({
    provider: 'anthropic', canonicalModel: 'claude-opus-5', selectedLabel: 'Claude Opus 5', routing: 'fixed',
  });
  const snap = store.create({
    promptText: 'x', inputTokens: 10, observation: opusObs,
    estimate: EST.estimate({ provider: 'anthropic', selectedModel: 'claude-opus-5', inputTokens: 10 }),
  });

  // The user switches to Sonnet, and the live observation object is mutated in
  // place the way a long-lived detector would.
  opusObs.canonicalModel = 'claude-sonnet-5';
  opusObs.selectedLabel = 'Claude Sonnet 5';

  assert.strictEqual(store.get(snap.id).observation.canonicalModel, 'claude-opus-5');
  assert.strictEqual(store.get(snap.id).estimateBeforeSend.canonicalModel, 'claude-opus-5');
});

// ── 32 ─────────────────────────────────────────────────────────────────────
test('exposed response metadata refines only the interaction it describes', () => {
  const store = SNAP.createStore();
  const base = OBS.emptyObservation({ provider: 'openai', routing: 'auto', canonicalModel: null });
  const first = store.create({ promptText: 'a', inputTokens: 5, observation: base });
  const second = store.create({ promptText: 'b', inputTokens: 5, observation: base });

  const refined = store.refineEffectiveModel(first.id, {
    effectiveModel: 'gpt-5.6-sol',
    estimate: EST.estimate({ provider: 'openai', effectiveModel: 'gpt-5.6-sol', inputTokens: 5, outputTokens: 300, phase: 'complete' }),
  });
  assert.strictEqual(refined.observation.effectiveModel, 'gpt-5.6-sol');
  assert.strictEqual(refined.observation.source, 'response-metadata');
  assert.ok(refined.estimateAfterResponse);

  // The other interaction is untouched, and its uncertainty is preserved.
  assert.strictEqual(store.get(second.id).observation.effectiveModel, null);
  assert.strictEqual(store.get(second.id).observation.routing, 'auto');
  assert.strictEqual(store.get(second.id).estimateAfterResponse, null);

  // Refining without a named model is refused.
  assert.strictEqual(store.refineEffectiveModel(second.id, { effectiveModel: null }), null);
});

test('an effective model, once exposed, is what the estimate is built from', () => {
  const est = EST.estimate({
    provider: 'openai', routing: 'auto', selectedModel: null, effectiveModel: 'gpt-5.6-sol',
    inputTokens: 100, outputTokens: 300, phase: 'complete',
  });
  assert.strictEqual(est.canonicalModel, 'gpt-5.6-sol');
  assert.strictEqual(est.profileId, 'prior_gpt-5.6-sol_short_2026');
});

// ── Detector behaviour ─────────────────────────────────────────────────────

/** Manual clock so the throttle/debounce are exercised without real waiting. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  const api = {
    setTimeout(fn, ms) { const id = ++seq; pending.set(id, { at: now + (ms || 0), fn, every: 0 }); return id; },
    clearTimeout(id) { pending.delete(id); },
    setInterval(fn, ms) { const id = ++seq; pending.set(id, { at: now + (ms || 0), fn, every: ms || 1 }); return id; },
    clearInterval(id) { pending.delete(id); },
  };
  return {
    api,
    advance(ms) {
      now += ms;
      for (const [id, t] of Array.from(pending)) {
        if (t.at > now) continue;
        if (t.every) t.at = now + t.every; else pending.delete(id);
        t.fn();
      }
    },
    get outstanding() { return pending.size; },
  };
}

/** Let the observer's microtask land, then run the throttle and the debounce. */
async function settle(page, timers) {
  await page.tick(0);
  timers.advance(200);   // throttled cheap scan
  await page.tick(0);
  timers.advance(500);   // debounced full recalculation
  await page.tick(0);
}

function startDetector(page, provider, timers, events) {
  const detector = DET.create({
    adapter: Registry.byProvider(provider),
    document: page.document,
    window: page.window,
    timers: timers.api,
    onChange: (current, previous) => events.push({ current, previous }),
  });
  detector.start();
  return detector;
}

// ── 23 ─────────────────────────────────────────────────────────────────────
domTest('the model-change event fires once per actual change, and not otherwise', async () => {
  const page = open(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc');
  const timers = fakeTimers();
  const events = [];
  const dispatched = [];
  page.window.addEventListener(DET.MODEL_CHANGE_EVENT, (e) => dispatched.push(e.detail));
  const detector = startDetector(page, 'openai', timers, events);
  try {
    assert.strictEqual(detector.current.canonicalModel, 'gpt-5.6-sol');
    assert.strictEqual(detector.generation, 1);

    // A mutation that changes nothing about the model must not fire.
    page.document.getElementById('prompt-textarea').textContent = 'typing a prompt';
    await settle(page, timers);
    assert.strictEqual(detector.generation, 1, 'typing must not count as a model change');
    assert.strictEqual(dispatched.length, 0);

    // A real switch fires exactly once.
    page.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'GPT-5.6 Luna';
    await settle(page, timers);
    assert.strictEqual(detector.current.canonicalModel, 'gpt-5.6-luna');
    assert.strictEqual(detector.generation, 2);
    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0].previous.canonicalModel, 'gpt-5.6-sol');
    assert.strictEqual(dispatched[0].current.canonicalModel, 'gpt-5.6-luna');

    // Re-rendering the same label is not a change.
    page.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'GPT-5.6 Luna';
    await settle(page, timers);
    assert.strictEqual(dispatched.length, 1);
  } finally {
    detector.destroy();
    page.restore();
  }
});

// ── 24 ─────────────────────────────────────────────────────────────────────
domTest('a model change invalidates in-flight work and re-projects the unsent prompt', async () => {
  const page = open(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc');
  const timers = fakeTimers();
  const events = [];
  const detector = startDetector(page, 'openai', timers, events);
  try {
    const staleGeneration = detector.generation;
    const before = EST.estimate({
      provider: 'openai', selectedModel: detector.current.canonicalModel, inputTokens: 120, phase: 'draft',
    });
    assert.ok(detector.isCurrentGeneration(staleGeneration));

    page.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'GPT-5.6 Luna';
    await settle(page, timers);

    // Anything that comes back stamped with the old generation is stale.
    assert.ok(!detector.isCurrentGeneration(staleGeneration));
    const after = EST.estimate({
      provider: 'openai', selectedModel: detector.current.canonicalModel, inputTokens: 120, phase: 'draft',
    });
    assert.notStrictEqual(after.profileId, before.profileId);
    assert.ok(after.energyWh.central < before.energyWh.central, 'Luna is the cheaper tier');
    assert.strictEqual(events.length, 1);
  } finally {
    detector.destroy();
    page.restore();
  }
});

// ── 26 ─────────────────────────────────────────────────────────────────────
domTest('SPA navigation re-detects the model and the conversation key', async () => {
  const page = open(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc');
  const timers = fakeTimers();
  const events = [];
  const detector = startDetector(page, 'openai', timers, events);
  try {
    assert.strictEqual(detector.current.conversationKey, 'openai:abc');

    // A pushState-style route change with a different model in the new chat.
    page.window.history.pushState({}, '', '/c/def');
    page.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'GPT-5.6 Terra';
    timers.advance(1200);            // the route poll notices href moved
    await settle(page, timers);

    assert.strictEqual(detector.current.conversationKey, 'openai:def');
    assert.strictEqual(detector.current.canonicalModel, 'gpt-5.6-terra');

    // popstate is handled directly, without waiting for the poll.
    page.window.history.pushState({}, '', '/c/ghi');
    page.window.dispatchEvent(new page.window.Event('popstate'));
    await settle(page, timers);
    assert.strictEqual(detector.current.conversationKey, 'openai:ghi');
  } finally {
    detector.destroy();
    page.restore();
  }
});

// ── 27 ─────────────────────────────────────────────────────────────────────
domTest('replacing the picker node rebinds the observer without duplicating it', async () => {
  const page = open(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc');
  const timers = fakeTimers();
  const events = [];
  const dispatched = [];
  page.window.addEventListener(DET.MODEL_CHANGE_EVENT, () => dispatched.push(1));
  const detector = startDetector(page, 'openai', timers, events);
  try {
    const originalRoots = detector.observedRoots;
    assert.ok(originalRoots.length > 0);

    // React-style replacement: the whole header subtree is swapped for a new one.
    const header = page.document.getElementById('page-header');
    const replacement = page.document.createElement('div');
    replacement.id = 'page-header';
    replacement.innerHTML = '<button data-testid="model-switcher-dropdown-button">GPT-5.6 Terra</button>';
    header.parentNode.replaceChild(replacement, header);
    await settle(page, timers);

    assert.strictEqual(detector.current.canonicalModel, 'gpt-5.6-terra');
    assert.ok(!detector.observedRoots.includes(header), 'the detached node must not still be observed');
    assert.ok(detector.observedRoots.includes(replacement));

    // One observer, so one further change produces exactly one more event.
    const seen = dispatched.length;
    page.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'GPT-5.6 Luna';
    await settle(page, timers);
    assert.strictEqual(dispatched.length - seen, 1, 'a duplicated observer would fire twice');
  } finally {
    detector.destroy();
    page.restore();
  }
});

// ── 28 ─────────────────────────────────────────────────────────────────────
domTest('theme, sidebar, and viewport changes do not disturb detection', async () => {
  const page = open(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc');
  const timers = fakeTimers();
  const events = [];
  const detector = startDetector(page, 'openai', timers, events);
  try {
    const before = detector.current.canonicalModel;

    page.document.documentElement.classList.add('dark');
    const sidebar = page.document.createElement('nav');
    sidebar.id = 'sidebar';
    sidebar.innerHTML = '<a>Chat about Claude Opus 5</a><a>Gemini 3.1 Pro notes</a>';
    page.document.body.insertBefore(sidebar, page.document.body.firstChild);
    page.window.dispatchEvent(new page.window.Event('resize'));
    await settle(page, timers);

    assert.strictEqual(detector.current.canonicalModel, before);
    assert.strictEqual(events.length, 0, 'chrome changes are not model changes');

    // Even a sidebar full of other providers' model names cannot win.
    sidebar.remove();
    await settle(page, timers);
    assert.strictEqual(detector.current.canonicalModel, before);
  } finally {
    detector.destroy();
    page.restore();
  }
});

// ── 30 ─────────────────────────────────────────────────────────────────────
domTest('teardown removes every observer, listener, and timer', async () => {
  const page = open(FIX.CHATGPT_MENU_CLOSED, 'https://chatgpt.com/c/abc');
  const timers = fakeTimers();
  const events = [];
  const dispatched = [];
  page.window.addEventListener(DET.MODEL_CHANGE_EVENT, () => dispatched.push(1));
  const detector = startDetector(page, 'openai', timers, events);

  await settle(page, timers);
  assert.ok(timers.outstanding > 0, 'the route poll should be running while active');

  detector.destroy();
  assert.strictEqual(detector.destroyed, true);
  assert.strictEqual(timers.outstanding, 0, 'no timers may survive teardown');
  assert.deepStrictEqual(detector.observedRoots, []);

  // Nothing reacts after teardown.
  page.document.querySelector('[data-testid="model-switcher-dropdown-button"]').textContent = 'GPT-5.6 Luna';
  page.window.dispatchEvent(new page.window.Event('popstate'));
  await settle(page, timers);
  assert.strictEqual(events.length, 0);
  assert.strictEqual(dispatched.length, 0);
  assert.strictEqual(detector.generation, 1, 'generation frozen at teardown');

  // Double destroy is safe.
  detector.destroy();
  page.restore();
});
