// The token analyzer, end to end in the in-page panel.
// ---------------------------------------------------------------------------
// The unit suites prove the counter, the document analyzer, and the breakdown in
// isolation. This one proves the wiring: that what the analyzer computes is what
// the popup shows, that a model switch repaints it, and — the requirement that
// ties the two halves of this work together — that after Replace prompt the
// analyzer counts the REPLACEMENT and not the original plus the replacement.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const dom = require('./helpers/dom.js');

const CTX = require('../lib/tokens/context.js');
const TRACK = require('../lib/tokens/attachments.js');
const PRESENT = require('../lib/models/present.js');

const FILES = path.join(__dirname, 'fixtures', 'files');

const VERBOSE_PROMPT = [
  'Hi there! I was wondering if you could please help me out with something.',
  'Basically, I would like you to write a summary of the quarterly report for',
  'Northwind Logistics covering Q3 2024. Please make sure it is under 200 words.',
  'Do not include any financial projections. Use a professional tone.',
  'The report is at https://example.com/q3.pdf and the contact is Dr. Chen.',
  'Thank you so much in advance!',
].join(' ');

const CHATGPT_OBS = {
  provider: 'openai', surface: 'chatgpt', canonicalModel: 'gpt-5.6-sol',
  selectedLabel: 'GPT-5.6 Sol', routing: 'fixed',
};
const CLAUDE_OBS = {
  provider: 'anthropic', surface: 'claude-web', canonicalModel: 'claude-opus-5',
  selectedLabel: 'Claude Opus 5', routing: 'fixed',
};

function fileFrom(name, bytes, type) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(Buffer.from(bytes));
  return {
    name, type: type || '', size: data.length, lastModified: 1755000000000,
    bytes: data,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length),
  };
}
const fixture = (name, type) => fileFrom(name, new Uint8Array(fs.readFileSync(path.join(FILES, name))), type);

function loadModules() {
  for (const p of ['../lib/editors.js', '../lib/composer.js', '../lib/assistantState.js', '../overlay/assistant.js']) {
    delete require.cache[require.resolve(p)];
  }
  return {
    composer: require('../lib/composer.js'),
    state: require('../lib/assistantState.js'),
    assistant: require('../overlay/assistant.js'),
    engine: require('../lib/tokenCutter.bundle.js'),
  };
}

/** Boot the assistant with a real analyzer stack behind it. */
async function boot(startObs) {
  const page = dom.createPage(dom.CHATGPT_HTML);
  const mods = loadModules();
  const el = page.document.getElementById('prompt-textarea');
  dom.size(el, { width: 620, height: 52, top: 640, bottom: 692, right: 720, left: 100 });

  let observation = startObs || CHATGPT_OBS;
  const target = () => ({
    provider: observation.provider,
    canonicalModel: observation.canonicalModel,
    selectedLabel: observation.selectedLabel,
    routing: observation.routing,
    surface: observation.surface,
  });

  const tracker = TRACK.createTracker({
    document: page.document,
    adapter: {
      composerSurfaceSelector: '#composer-background',
      attachmentSelectors: ['[data-testid="composer-file-chip"]'],
    },
    getTarget: target,
    getSurface: () => observation.surface,
    onChange: () => { if (instance) instance.contextChanged(); },
  });
  const context = CTX.createContext({ getTarget: target, getSurface: () => observation.surface, tracker });

  const stored = { writingChecksEnabled: true };
  let subscriber = null;
  const instance = mods.assistant.createAssistant({
    engine: mods.engine,
    composer: mods.composer,
    state: mods.state,
    format: require('../lib/formatters.js'),
    platform: 'chatgpt',
    adapterSelector: '#prompt-textarea',
    memory: mods.engine.emptyMemory(),
    present: PRESENT,
    context,
    getModel: () => observation,
    subscribeModel: (fn) => { subscriber = fn; return () => { subscriber = null; }; },
    getConfig: async () => stored,
    setConfig: async (patch) => Object.assign(stored, patch),
    resetSettings: async () => {},
    onReplaced: () => {},
  });
  await instance.start();
  tracker.start();

  return {
    page,
    instance,
    el,
    tracker,
    context,
    composerLib: mods.composer,
    switchModel(next) {
      observation = next;
      if (subscriber) subscriber(next);
    },
    /** Render a chip and hand the tracker the file, as the product would. */
    async attach(file) {
      const chip = page.document.createElement('div');
      chip.setAttribute('data-testid', 'composer-file-chip');
      chip.setAttribute('title', file.name);
      chip.textContent = file.name;
      page.document.getElementById('composer-background').appendChild(chip);
      tracker.noteFiles([file], 'drop');
      tracker.syncFromDom();
      await tracker.settle();
      instance.contextChanged();
      return chip;
    },
    shadowText(id) {
      const node = instance.shadow.getElementById(id);
      return node ? node.textContent : null;
    },
  };
}

function type(page, el, text) {
  el.innerHTML = text.split('\n').map((line) => `<p>${line || '<br>'}</p>`).join('');
  el.dispatchEvent(new page.window.Event('input', { bubbles: true }));
}

// ── The definition-of-done walkthrough ─────────────────────────────────────

test('ChatGPT is detected as ChatGPT, with a model and a matching tokenizer',
  { skip: !dom.available }, async () => {
    const h = await boot(CHATGPT_OBS);
    try {
      type(h.page, h.el, VERBOSE_PROMPT);
      await h.page.tick(20);
      const b = h.instance.breakdown;
      assert.strictEqual(b.provider, 'openai', 'not Claude, and not "unknown"');
      assert.strictEqual(b.model, 'gpt-5.6-sol');
      assert.strictEqual(b.tokenizer, 'o200k_base');
      assert.strictEqual(h.shadowText('context-model'), 'GPT-5.6 Sol — detected');
    } finally { h.instance.destroy(); h.page.restore(); }
  });

test('attaching a large PDF makes the count jump and names the file',
  { skip: !dom.available }, async () => {
    const h = await boot(CLAUDE_OBS);
    try {
      type(h.page, h.el, 'Summarize this report and identify the risks');
      await h.page.tick(20);
      const before = h.instance.breakdown.total;
      assert.ok(before < 30, `a short prompt really is short: ${before}`);

      await h.attach(fixture('report-6p.pdf', 'application/pdf'));
      const after = h.instance.breakdown.total;
      assert.ok(after > before * 100, `${before} -> ${after}: the PDF must dominate`);

      const rows = h.shadowText('context-rows');
      assert.match(rows, /report-6p\.pdf/);
      assert.match(rows, /6 pages/);
      assert.match(rows, /document\/visual/, 'the visual half is shown separately');
      assert.match(h.shadowText('context-accuracy'), /PDF/);
    } finally { h.instance.destroy(); h.page.restore(); }
  });

test('a markdown file and a code file are both included', { skip: !dom.available }, async () => {
  const h = await boot(CHATGPT_OBS);
  try {
    type(h.page, h.el, 'Review these two files for me please.');
    await h.page.tick(20);
    const before = h.instance.breakdown.total;

    await h.attach(fileFrom('notes.md', '# Notes\n\n- A bullet about the report.\n'.repeat(200)));
    const withMd = h.instance.breakdown.total;
    await h.attach(fileFrom('server.py', 'def handler(request):\n    return {"ok": True}\n'.repeat(200)));
    const withBoth = h.instance.breakdown.total;

    assert.ok(withMd > before);
    assert.ok(withBoth > withMd);
    assert.strictEqual(h.instance.breakdown.attachments.length, 2);
  } finally { h.instance.destroy(); h.page.restore(); }
});

test('pasting a huge block is included, and only once', { skip: !dom.available }, async () => {
  const h = await boot(CHATGPT_OBS);
  try {
    const huge = 'The quarterly summary covers every region and lists each risk. '.repeat(400);
    h.context.notePaste(huge);
    type(h.page, h.el, `Summarize this:\n\n${huge}`);
    await h.page.tick(20);

    const b = h.instance.breakdown;
    assert.ok(b.total > 3000, `a 25,000-character paste is not small: ${b.total}`);
    const sum = b.parts.reduce((n, p) => n + p.tokens, 0);
    assert.strictEqual(b.total, sum, 'no line is counted twice');
    assert.ok(b.parts.some((p) => p.id === 'pasted'));
  } finally { h.instance.destroy(); h.page.restore(); }
});

test('removing an attachment updates the calculation immediately',
  { skip: !dom.available }, async () => {
    const h = await boot(CLAUDE_OBS);
    try {
      type(h.page, h.el, 'Summarize this report and identify the risks');
      await h.page.tick(20);
      const bare = h.instance.breakdown.total;

      const chip = await h.attach(fixture('report-6p.pdf', 'application/pdf'));
      assert.ok(h.instance.breakdown.total > bare);

      chip.remove();
      h.tracker.syncFromDom();
      h.instance.contextChanged();
      assert.strictEqual(h.instance.breakdown.total, bare, 'straight back down');
      assert.strictEqual(h.instance.breakdown.attachments.length, 0);
    } finally { h.instance.destroy(); h.page.restore(); }
  });

test('after Replace prompt the analyzer counts the replacement ONLY',
  { skip: !dom.available }, async () => {
    // The two halves of this work meeting: if the replacement had appended, this
    // number would be the sum of both prompts, and the analyzer would report it
    // faithfully. It is the strongest single check that the bug is gone.
    const h = await boot(CHATGPT_OBS);
    try {
      const editor = dom.attachModelEditor(h.el);
      editor.state = VERBOSE_PROMPT;
      h.el.dispatchEvent(new h.page.window.Event('input', { bubbles: true }));
      await h.page.tick(700);                       // past the analysis debounce

      const original = h.instance.breakdown.total;
      const optimized = h.instance.optimized;
      assert.ok(optimized && optimized !== VERBOSE_PROMPT, 'the optimizer produced something');

      assert.strictEqual(h.instance.replacePrompt(), true);
      await h.page.tick(120);
      h.instance.contextChanged();

      assert.strictEqual(editor.state, optimized, 'the composer holds only the replacement');
      const after = h.instance.breakdown.total;
      assert.ok(after < original, `${original} -> ${after}: the count must go DOWN`);

      const { count } = require('../lib/tokens/counter.js');
      assert.strictEqual(after, count(optimized, { provider: 'openai', canonicalModel: 'gpt-5.6-sol' }),
        'exactly the replacement, not the original plus the replacement');
    } finally { h.instance.destroy(); h.page.restore(); }
  });

test('switching provider re-costs everything with the other tokenizer',
  { skip: !dom.available }, async () => {
    const h = await boot(CHATGPT_OBS);
    try {
      type(h.page, h.el, VERBOSE_PROMPT);
      await h.page.tick(20);
      await h.attach(fixture('report-6p.pdf', 'application/pdf'));
      const asChatGpt = h.instance.breakdown;
      assert.strictEqual(asChatGpt.tokenizer, 'o200k_base');

      h.switchModel(CLAUDE_OBS);
      await h.page.tick(20);
      const asClaude = h.instance.breakdown;
      assert.strictEqual(asClaude.tokenizer, 'claude-4.7');
      assert.ok(asClaude.total !== asChatGpt.total,
        'the same request must not cost the same on two different tokenizers');
      assert.strictEqual(h.shadowText('context-model'), 'Claude Opus 5 — detected');
    } finally { h.instance.destroy(); h.page.restore(); }
  });

// ── Honesty of the panel ───────────────────────────────────────────────────

test('Auto is shown as Auto and never resolved into a model', { skip: !dom.available }, async () => {
  const h = await boot({ provider: 'openai', surface: 'chatgpt', routing: 'auto', selectedLabel: 'Auto' });
  try {
    type(h.page, h.el, VERBOSE_PROMPT);
    await h.page.tick(20);
    const line = h.shadowText('context-model');
    assert.match(line, /Auto — exact routed model unavailable/);
    assert.ok(!/GPT-5\.6/.test(line), 'no model name may be invented for a routed request');
    assert.strictEqual(h.instance.breakdown.model, null);
    assert.strictEqual(h.instance.breakdown.contextPercent, null, 'and no context share either');
  } finally { h.instance.destroy(); h.page.restore(); }
});

test('the panel never calls a local count exact', { skip: !dom.available }, async () => {
  const h = await boot(CLAUDE_OBS);
  try {
    type(h.page, h.el, VERBOSE_PROMPT);
    await h.page.tick(20);
    const accuracy = h.shadowText('context-accuracy');
    assert.match(accuracy, /Estimated/);
    assert.ok(!/exact/i.test(accuracy));
    assert.notStrictEqual(h.instance.breakdown.confidence, 'exact');
  } finally { h.instance.destroy(); h.page.restore(); }
});

test('unmeasurable platform context is named, with no number attached',
  { skip: !dom.available }, async () => {
    const h = await boot(CLAUDE_OBS);
    try {
      type(h.page, h.el, VERBOSE_PROMPT);
      await h.page.tick(20);
      const note = h.shadowText('context-unmeasured');
      assert.match(note, /system prompt/i);
      assert.match(note, /reasoning tokens/i);
      assert.match(note, /Not included/i);
      assert.ok(!/\d{3,}/.test(note), 'naming what we cannot see must not come with a figure');
    } finally { h.instance.destroy(); h.page.restore(); }
  });

test('the indicator stays visible for a short prompt with a file attached',
  { skip: !dom.available }, async () => {
    // "Summarize this" is under the optimizer's 16-character floor. With a PDF
    // beside it, hiding the indicator would be exactly the old bug.
    const h = await boot(CLAUDE_OBS);
    try {
      type(h.page, h.el, 'Summarize');
      await h.page.tick(20);
      assert.strictEqual(h.instance.state, 'empty');

      await h.attach(fixture('report-6p.pdf', 'application/pdf'));
      assert.strictEqual(h.instance.state, 'attachments');
      assert.strictEqual(h.instance.host.hidden, false);
      assert.match(h.shadowText('headline'), /tokens in/);
    } finally { h.instance.destroy(); h.page.restore(); }
  });

test('a context-window share appears only for a model whose window is documented',
  { skip: !dom.available }, async () => {
    const h = await boot(CLAUDE_OBS);
    try {
      type(h.page, h.el, VERBOSE_PROMPT);
      await h.page.tick(20);
      const windowEl = h.instance.shadow.getElementById('context-window');
      assert.strictEqual(windowEl.hidden, false);
      assert.match(windowEl.textContent, /% of context/);

      h.switchModel({ provider: 'openai', surface: 'chatgpt', canonicalModel: 'gpt-5.4-thinking', selectedLabel: 'GPT-5.4 Thinking' });
      await h.page.tick(20);
      assert.strictEqual(h.instance.shadow.getElementById('context-window').hidden, true,
        'no documented window, no percentage');
    } finally { h.instance.destroy(); h.page.restore(); }
  });

// ── The presentation rules, on their own ───────────────────────────────────

test('every detection state names exactly what is known', () => {
  assert.strictEqual(PRESENT.tokenModelLine(CLAUDE_OBS), 'Claude Opus 5 — detected');
  assert.strictEqual(PRESENT.tokenModelLine(CHATGPT_OBS), 'GPT-5.6 Sol — detected');
  assert.strictEqual(
    PRESENT.tokenModelLine({ provider: 'openai', surface: 'chatgpt', routing: 'auto' }),
    'ChatGPT Auto — exact routed model unavailable',
  );
  assert.strictEqual(
    PRESENT.tokenModelLine({ provider: 'openai', surface: 'chatgpt', selectedLabel: 'GPT-7.2 Nimbus' }),
    'GPT-7.2 Nimbus — detected, not in the registry',
  );
  assert.strictEqual(
    PRESENT.tokenModelLine({ provider: 'openai', surface: 'chatgpt' }),
    'OpenAI model — estimated tokenization',
  );
  assert.strictEqual(PRESENT.tokenModelLine({}), 'Model not detected — generic estimate');
});

test('the detection chain reports provider, product, model, family, and tokenizer', () => {
  const chain = PRESENT.detectionChain(CHATGPT_OBS, {
    tokenizer: 'o200k_base', method: 'local-tokenizer', confidence: 'high',
  });
  assert.deepStrictEqual(chain, {
    provider: 'ChatGPT',
    providerId: 'openai',
    product: 'ChatGPT',
    uiLabel: 'GPT-5.6 Sol',
    canonicalModel: 'gpt-5.6-sol',
    family: 'gpt-5.6',
    tokenizer: 'o200k_base',
    method: 'local-tokenizer',
    confidence: 'high',
    state: 'detected',
  });
  assert.strictEqual(
    PRESENT.detectionChain({ provider: 'openai', surface: 'chatgpt', routing: 'auto' }, {}).state,
    'routed',
  );
});

test('the accuracy line names the weakest part of the total', () => {
  assert.match(PRESENT.accuracyLine({ confidence: 'high', tokenizer: 'o200k_base', parts: [{ kind: 'text' }] }),
    /counted locally with the o200k_base tokenizer/);
  assert.match(PRESENT.accuracyLine({ parts: [{ kind: 'text' }, { kind: 'pdf' }] }),
    /document and visual processing/);
  assert.match(PRESENT.accuracyLine({ parts: [{ kind: 'opaque' }] }), /estimated from its size/);
  assert.match(PRESENT.accuracyLine({ parts: [{ kind: 'pdf', unreadable: true }] }), /could not be read/);
  assert.match(PRESENT.accuracyLine({ method: 'generic-estimate', parts: [] }), /provider not identified/);
});
