const test = require('node:test');
const assert = require('node:assert');
const dom = require('./helpers/dom.js');

// End-to-end behaviour of the in-page assistant against a page shaped like
// ChatGPT: mounting (exactly once), analysis after a typing pause, replacing the
// prompt, undoing back to the exact original, and cleaning up after itself.
//
// The engine used here is the real Token Cutter bundle, so these tests fail if
// the bundle is stale or missing — which is the point: the assistant is only
// meaningful when it is wired to the engine the dashboard uses.

const VERBOSE_PROMPT = [
  'Hi there! I was wondering if you could please help me out with something.',
  'Basically, I would like you to write a summary of the quarterly report for',
  'Northwind Logistics covering Q3 2024. Please make sure it is under 200 words.',
  'Do not include any financial projections. Use a professional tone.',
  'The report is at https://example.com/q3.pdf and the contact is Dr. Chen.',
  'Thank you so much in advance!',
].join(' ');

function loadModules() {
  // Required after the DOM globals are installed, and re-required per page so
  // module-level state can never leak between tests.
  for (const p of ['../lib/composer.js', '../lib/assistantState.js', '../overlay/assistant.js']) {
    delete require.cache[require.resolve(p)];
  }
  return {
    composer: require('../lib/composer.js'),
    state: require('../lib/assistantState.js'),
    assistant: require('../overlay/assistant.js'),
    engine: require('../lib/tokenCutter.bundle.js'),
  };
}

/** Boot an assistant on a ChatGPT-shaped page. */
async function boot(overrides) {
  const page = dom.createPage(dom.CHATGPT_HTML);
  const mods = loadModules();
  const el = page.document.getElementById('prompt-textarea');
  dom.size(el, { width: 620, height: 52, top: 640, bottom: 692, right: 720, left: 100 });

  const stored = { writingChecksEnabled: true, ...(overrides && overrides.config) };
  const replaced = [];
  const deps = {
    engine: mods.engine,
    composer: mods.composer,
    state: mods.state,
    format: require('../lib/formatters.js'),
    platform: 'chatgpt',
    adapterSelector: '#prompt-textarea',
    memory: mods.engine.emptyMemory(),
    getConfig: async () => stored,
    setConfig: async (patch) => Object.assign(stored, patch),
    resetSettings: async () => { Object.assign(stored, mods.state.resetPatch()); },
    onReplaced: (s) => replaced.push(s),
    ...(overrides && overrides.deps),
  };

  const instance = mods.assistant.createAssistant(deps);
  await instance.start();
  return { page, instance, composerEl: el, deps, stored, replaced, composerLib: mods.composer };
}

/** Type into the composer the way a person does — one input event per change. */
function type(page, el, text) {
  el.innerHTML = `<p>${text}</p>`;
  el.dispatchEvent(new page.window.Event('input', { bubbles: true }));
}

// ── Mounting ───────────────────────────────────────────────────────────────

test('mounts a single shadow-DOM host', { skip: !dom.available }, async () => {
  const { page, instance } = await boot();
  try {
    const hosts = page.document.querySelectorAll('#pf-assistant-root');
    assert.strictEqual(hosts.length, 1);
    assert.ok(instance.shadow, 'UI lives in a shadow root so page CSS cannot reach it');
    assert.ok(instance.shadow.querySelector('.shell'));
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('a second assistant refuses to mount over the first', { skip: !dom.available }, async () => {
  const { page, instance, deps } = await boot();
  try {
    const mods = {
      assistant: require('../overlay/assistant.js'),
    };
    const second = mods.assistant.createAssistant(deps);
    const started = await second.start();
    assert.strictEqual(started, false, 'the duplicate must decline to start');
    assert.strictEqual(page.document.querySelectorAll('#pf-assistant-root').length, 1);
    second.destroy();
    // Declining to start must not have torn down the original.
    assert.strictEqual(page.document.querySelectorAll('#pf-assistant-root').length, 1);
    assert.ok(instance.host && instance.host.isConnected);
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('binds to the composer and stays quiet while it is empty', { skip: !dom.available }, async () => {
  const { page, instance, composerEl } = await boot();
  try {
    assert.strictEqual(instance.composer, composerEl);
    assert.strictEqual(instance.state, 'empty');
    assert.strictEqual(instance.host.hidden, true, 'nothing is shown for an empty composer');
  } finally {
    instance.destroy();
    page.restore();
  }
});

// ── Analysis ───────────────────────────────────────────────────────────────

test('analyzes after a pause and offers a real saving', { skip: !dom.available }, async () => {
  const { page, instance, composerEl } = await boot();
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    assert.strictEqual(instance.state, 'typing', 'no analysis while the keys are still moving');

    await page.tick(900);
    assert.strictEqual(instance.state, 'available');
    assert.ok(instance.analytics.tokensSaved > 0);
    assert.ok(instance.analytics.percentReduction > 0);
    assert.strictEqual(instance.host.hidden, false);

    // The preservation contract actually ran, and the things that must survive did.
    assert.strictEqual(instance.result.validation.validated, true);
    assert.strictEqual(instance.result.validation.ok, true);
    for (const must of ['Northwind Logistics', '200 words', 'https://example.com/q3.pdf', 'Dr. Chen']) {
      assert.ok(instance.optimized.includes(must), `optimized prompt must keep "${must}"`);
    }
    assert.match(instance.optimized, /\bDo not\b/i, 'negations are never dropped');
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('says "already concise" instead of inventing changes', { skip: !dom.available }, async () => {
  const { page, instance, composerEl } = await boot();
  try {
    type(page, composerEl, 'Summarize this article in three bullet points.');
    await page.tick(900);
    assert.strictEqual(instance.state, 'concise');
    assert.strictEqual(instance.host.hidden, false, 'a short prompt still gets a quiet indicator');
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('typing again during analysis discards the stale result', { skip: !dom.available }, async () => {
  const { page, instance, composerEl } = await boot();
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    await page.tick(900);
    const firstOptimized = instance.optimized;

    type(page, composerEl, 'A completely different prompt about migrating a Postgres database safely.');
    assert.strictEqual(instance.state, 'typing');
    assert.ok(!instance.host.hidden);

    await page.tick(900);
    assert.notStrictEqual(instance.optimized, firstOptimized);
    assert.ok(!instance.optimized.includes('Northwind'), 'the old analysis is gone, not merged');
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('with automatic analysis off, typing never triggers the engine',
  { skip: !dom.available }, async () => {
    const { page, instance, composerEl } = await boot({
      config: { assistantAutoAnalyze: false },
    });
    try {
      assert.strictEqual(instance.settings.autoAnalyze, false);
      type(page, composerEl, VERBOSE_PROMPT);
      await page.tick(1200);
      assert.strictEqual(instance.analytics, null, 'no analysis ran');
    } finally {
      instance.destroy();
      page.restore();
    }
  });

test('the compression level changes what is proposed', { skip: !dom.available }, async () => {
  const { page, instance, composerEl } = await boot({ config: { assistantLevel: 'light' } });
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    await page.tick(900);
    const light = instance.analytics.tokensSaved;

    instance.setLevel('maximum');
    await page.tick(900);
    assert.ok(
      instance.analytics.tokensSaved >= light,
      `maximum (${instance.analytics.tokensSaved}) should cut at least as much as light (${light})`,
    );
    assert.strictEqual(instance.settings.level, 'maximum');
  } finally {
    instance.destroy();
    page.restore();
  }
});

// ── Replace and undo ───────────────────────────────────────────────────────

test('replacing writes the optimized prompt into the composer', { skip: !dom.available }, async () => {
  const { page, instance, composerEl, composerLib, replaced } = await boot();
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    await page.tick(900);
    const optimized = instance.optimized;

    composerEl.focus();
    instance.replacePrompt();

    assert.strictEqual(composerLib.readText(composerEl), optimized);
    assert.strictEqual(instance.state, 'replaced');
    assert.strictEqual(instance.canUndo, true);
    assert.strictEqual(replaced.length, 1, 'realized savings are recorded once');
    assert.ok(replaced[0].savedTokens > 0);
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('nothing is ever replaced without an explicit action', { skip: !dom.available }, async () => {
  const { page, instance, composerEl, composerLib, replaced } = await boot();
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    await page.tick(1500);
    assert.strictEqual(composerLib.readText(composerEl), VERBOSE_PROMPT,
      'the composer still holds exactly what the user typed');
    assert.strictEqual(replaced.length, 0);
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('undo restores the original prompt byte for byte', { skip: !dom.available }, async () => {
  const { page, instance, composerEl, composerLib } = await boot();
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    await page.tick(900);

    composerEl.focus();
    instance.replacePrompt();
    assert.notStrictEqual(composerLib.readText(composerEl), VERBOSE_PROMPT);

    instance.undo();
    assert.strictEqual(composerLib.readText(composerEl), VERBOSE_PROMPT);
    assert.strictEqual(instance.canUndo, false, 'undo is spent once used');
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('replacement reaches an editor that owns its own model', { skip: !dom.available }, async () => {
  const { page, instance, composerEl } = await boot();
  try {
    const editor = dom.attachModelEditor(composerEl);
    editor.state = VERBOSE_PROMPT;
    composerEl.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    await page.tick(900);
    assert.strictEqual(instance.state, 'available');

    composerEl.focus();
    instance.replacePrompt();

    // The model is what gets sent. Checking the DOM alone would have passed even
    // when this was broken.
    assert.strictEqual(editor.state, instance.optimized);
    assert.strictEqual(editor.inSync, true);
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('a prompt edited after analysis is never overwritten with the stale result',
  { skip: !dom.available }, async () => {
    const { page, instance, composerEl, composerLib, replaced } = await boot();
    try {
      type(page, composerEl, VERBOSE_PROMPT);
      await page.tick(900);
      assert.strictEqual(instance.state, 'available');

      // The user adds something crucial and hits Replace before re-analysis.
      const edited = `${VERBOSE_PROMPT} IMPORTANT: reply in French.`;
      type(page, composerEl, edited);
      const applied = instance.replacePrompt();

      assert.strictEqual(applied, false, 'the stale optimization must be refused');
      assert.strictEqual(composerLib.readText(composerEl), edited,
        'the sentence typed after analysis survives');
      assert.strictEqual(replaced.length, 0, 'nothing was recorded as replaced');
    } finally {
      instance.destroy();
      page.restore();
    }
  });

test('Replace is disabled while the prompt differs from what was analyzed',
  { skip: !dom.available }, async () => {
    const { page, instance, composerEl } = await boot();
    try {
      type(page, composerEl, VERBOSE_PROMPT);
      await page.tick(900);
      instance.setExpanded(true);
      const button = instance.shadow.getElementById('act-replace');
      assert.strictEqual(button.disabled, false);

      type(page, composerEl, `${VERBOSE_PROMPT} One more requirement here.`);
      assert.strictEqual(button.disabled, true,
        'the button must go dead the moment the text drifts');
    } finally {
      instance.destroy();
      page.restore();
    }
  });

test('rapid consecutive Replace clicks apply exactly once', { skip: !dom.available }, async () => {
  const { page, instance, composerEl, composerLib, replaced } = await boot();
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    await page.tick(900);
    const optimized = instance.optimized;

    composerEl.focus();
    const outcomes = [instance.replacePrompt(), instance.replacePrompt(), instance.replacePrompt()];

    assert.deepStrictEqual(outcomes, [true, false, false], 'only the first click does work');
    assert.strictEqual(composerLib.readText(composerEl), optimized);
    assert.strictEqual(replaced.length, 1, 'savings are recorded once, not three times');
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('undo survives an editor that normalizes whitespace on the way in',
  { skip: !dom.available }, async () => {
    const { page, instance, composerEl, composerLib } = await boot();
    try {
      type(page, composerEl, VERBOSE_PROMPT);
      await page.tick(900);
      composerEl.focus();
      instance.replacePrompt();

      // The host editor settles a moment later with its own spacing and tells us
      // via a normal input event. That is our echo, not the user typing.
      const settled = `  ${instance.optimized.replace(/ /g, '  ')}  `;
      composerEl.innerHTML = `<p>${settled}</p>`;
      composerEl.dispatchEvent(new page.window.Event('input', { bubbles: true }));
      await page.tick(50);

      assert.strictEqual(instance.canUndo, true, 'undo must not be retired by our own write');
      instance.undo();
      assert.strictEqual(composerLib.readText(composerEl), VERBOSE_PROMPT);
    } finally {
      instance.destroy();
      page.restore();
    }
  });

test('Keep original cancels without touching the prompt', { skip: !dom.available }, async () => {
  const { page, instance, composerEl, composerLib, replaced } = await boot();
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    await page.tick(900);
    instance.setExpanded(true);
    instance.shadow.getElementById('act-keep').click();
    await page.tick(50);

    assert.strictEqual(composerLib.readText(composerEl), VERBOSE_PROMPT);
    assert.strictEqual(replaced.length, 0);
    assert.strictEqual(instance.canUndo, false);
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('a long prompt is replaced in full', { skip: !dom.available }, async () => {
  const { page, instance, composerEl, composerLib } = await boot();
  try {
    const long = Array.from({ length: 60 }, (_, i) =>
      `Please could you kindly review section ${i + 1} of the report in detail.`).join(' ');
    type(page, composerEl, long);
    await page.tick(1200);
    assert.strictEqual(instance.state, 'available');

    composerEl.focus();
    assert.strictEqual(instance.replacePrompt(), true);
    assert.strictEqual(composerLib.readText(composerEl), instance.optimized);
    assert.ok(instance.optimized.length < long.length);
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('editing after a replacement retires undo rather than restoring the wrong text',
  { skip: !dom.available }, async () => {
    const { page, instance, composerEl } = await boot();
    try {
      type(page, composerEl, VERBOSE_PROMPT);
      await page.tick(900);
      composerEl.focus();
      instance.replacePrompt();
      assert.strictEqual(instance.canUndo, true);

      type(page, composerEl, 'I have now written something else entirely, thank you very much.');
      assert.strictEqual(instance.canUndo, false);
    } finally {
      instance.destroy();
      page.restore();
    }
  });

// ── Settings ───────────────────────────────────────────────────────────────

test('turning the assistant off hides it and stops analysis', { skip: !dom.available }, async () => {
  const { page, instance, composerEl, stored } = await boot();
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    await page.tick(900);
    assert.strictEqual(instance.host.hidden, false);

    instance.applySettings({ ...instance.settings, enabled: false });
    assert.strictEqual(instance.host.hidden, true);

    type(page, composerEl, `${VERBOSE_PROMPT} And one more sentence for good measure.`);
    await page.tick(900);
    assert.strictEqual(instance.host.hidden, true, 'a disabled assistant stays gone');
    assert.ok('writingChecksEnabled' in stored);
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('settings changes are written through the shared pf_config layer',
  { skip: !dom.available }, async () => {
    const { page, instance, stored } = await boot();
    try {
      instance.setLevel('maximum');
      await page.tick(10);
      assert.strictEqual(stored.assistantLevel, 'maximum',
        'the assistant uses the existing config store, not a second one');
    } finally {
      instance.destroy();
      page.restore();
    }
  });

test('local mode never calls out to the network', { skip: !dom.available }, async () => {
  let calls = 0;
  const { page, instance, composerEl } = await boot({
    deps: { requestEnhanced: async () => { calls += 1; return { text: 'x' }; } },
  });
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    await page.tick(900);
    assert.strictEqual(instance.settings.mode, 'local');
    assert.strictEqual(calls, 0, 'no prompt may leave the device in local mode');
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('choosing enhanced mode without the cloud opt-in stays local',
  { skip: !dom.available }, async () => {
    let calls = 0;
    const { page, instance, composerEl, stored } = await boot({
      deps: { requestEnhanced: async () => { calls += 1; return { text: 'x' }; } },
    });
    try {
      instance.setLevel('light');                 // any save exercises the same path
      await page.tick(10);
      await instance.applySettings({ ...instance.settings, mode: 'enhanced' });
      instance.setLevel('balanced');
      await page.tick(20);
      assert.strictEqual(instance.settings.mode, 'local',
        'the stored config is the authority — enhanced needs cloudAnalysisEnabled too');
      assert.ok(!('cloudAnalysisEnabled' in stored) || stored.cloudAnalysisEnabled !== true);

      type(page, composerEl, VERBOSE_PROMPT);
      await page.tick(900);
      assert.strictEqual(calls, 0, 'no prompt left the device');
    } finally {
      instance.destroy();
      page.restore();
    }
  });

test('an enhanced rewrite that loses required detail is rejected',
  { skip: !dom.available }, async () => {
    const { page, instance, composerEl } = await boot({
      config: { assistantMode: 'enhanced', cloudAnalysisEnabled: true },
      // A plausible-looking rewrite that quietly drops the word limit, the URL,
      // and the negative instruction.
      deps: { requestEnhanced: async () => ({ text: 'Summarize the Northwind Logistics Q3 report.', status: 'success' }) },
    });
    try {
      assert.strictEqual(instance.settings.mode, 'enhanced');
      type(page, composerEl, VERBOSE_PROMPT);
      await page.tick(1000);
      assert.ok(
        instance.optimized.includes('https://example.com/q3.pdf'),
        'the local result is kept when the remote one fails validation',
      );
    } finally {
      instance.destroy();
      page.restore();
    }
  });

// ── Failure and lifecycle ──────────────────────────────────────────────────

test('an engine failure is reported calmly and leaves the prompt alone',
  { skip: !dom.available }, async () => {
    const { page, instance, composerEl, composerLib } = await boot({
      deps: {
        engine: {
          analyzePrompt() { throw new Error('engine exploded'); },
          emptyMemory: () => ({ enabled: true, entries: [] }),
          estimateTokens: (t) => Math.ceil((t || '').length / 4),
        },
      },
    });
    try {
      type(page, composerEl, VERBOSE_PROMPT);
      await page.tick(900);
      assert.strictEqual(instance.state, 'failed');
      assert.strictEqual(composerLib.readText(composerEl), VERBOSE_PROMPT);
    } finally {
      instance.destroy();
      page.restore();
    }
  });

test('a missing engine bundle degrades to "unavailable", not a crash',
  { skip: !dom.available }, async () => {
    const { page, instance, composerEl } = await boot({ deps: { engine: null } });
    try {
      type(page, composerEl, VERBOSE_PROMPT);
      await page.tick(900);
      assert.strictEqual(instance.state, 'unavailable');
      assert.strictEqual(instance.host.hidden, true);
    } finally {
      instance.destroy();
      page.restore();
    }
  });

test('destroy removes the host and stops responding to the page',
  { skip: !dom.available }, async () => {
    const { page, instance, composerEl } = await boot();
    try {
      type(page, composerEl, VERBOSE_PROMPT);
      await page.tick(900);
      assert.strictEqual(page.document.querySelectorAll('#pf-assistant-root').length, 1);

      instance.destroy();
      assert.strictEqual(page.document.querySelectorAll('#pf-assistant-root').length, 0);

      // Listeners are gone: further input must not resurrect anything.
      type(page, composerEl, 'more typing after teardown, which should be ignored entirely');
      await page.tick(900);
      assert.strictEqual(page.document.querySelectorAll('#pf-assistant-root').length, 0);
      assert.strictEqual(instance.host, null);
    } finally {
      page.restore();
    }
  });

test('a page that removes our host gets it back, still only once',
  { skip: !dom.available }, async () => {
    const { page, instance } = await boot();
    try {
      instance.host.remove();
      assert.strictEqual(page.document.querySelectorAll('#pf-assistant-root').length, 0);
      instance.ensureAlive();
      assert.strictEqual(page.document.querySelectorAll('#pf-assistant-root').length, 1);
      instance.ensureAlive();
      assert.strictEqual(page.document.querySelectorAll('#pf-assistant-root').length, 1);
    } finally {
      instance.destroy();
      page.restore();
    }
  });

test('switching conversations rebinds to the new composer', { skip: !dom.available }, async () => {
  const { page, instance, composerEl } = await boot();
  try {
    type(page, composerEl, VERBOSE_PROMPT);
    await page.tick(900);
    assert.strictEqual(instance.state, 'available');

    // ChatGPT replaces the composer node when you open another conversation.
    const form = page.document.querySelector('form');
    composerEl.remove();
    const next = page.document.createElement('div');
    next.setAttribute('contenteditable', 'true');
    next.id = 'prompt-textarea';
    next.setAttribute('data-lexical-editor', 'true');
    next.setAttribute('data-placeholder', 'Ask anything');
    form.querySelector('#composer-background').prepend(next);
    dom.size(next, { width: 620, height: 52, top: 640, bottom: 692, right: 720, left: 100 });

    instance.detect();
    await page.tick(900);
    assert.strictEqual(instance.composer, next);
    assert.strictEqual(instance.state, 'empty', 'the new conversation starts clean');
  } finally {
    instance.destroy();
    page.restore();
  }
});

test('dark and light are followed from the page, not the OS', { skip: !dom.available }, async () => {
  const { page, instance } = await boot();
  try {
    assert.strictEqual(instance.host.getAttribute('data-theme'), 'dark',
      'the fixture page carries ChatGPT\'s .dark class');
    page.document.documentElement.classList.remove('dark');
    page.document.documentElement.classList.add('light');
    instance.detect();
    assert.strictEqual(instance.host.getAttribute('data-theme'), 'light');
  } finally {
    instance.destroy();
    page.restore();
  }
});
