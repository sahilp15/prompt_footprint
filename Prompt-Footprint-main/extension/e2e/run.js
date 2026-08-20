#!/usr/bin/env node
// PromptFootprint — in-page assistant, end-to-end in a real browser.
// ---------------------------------------------------------------------------
// Loads the UNMODIFIED extension into Chromium and drives it against pages
// shaped like ChatGPT and Claude. This is not a duplicate of the node:test
// suite: it is the only place the code meets a real layout engine, a real
// contenteditable, real shadow DOM, and Chrome's own JS semantics.
//
// It has earned its keep. Bugs it found that jsdom could not:
//   • `{ setTimeout }` passed as an object property — "Illegal invocation" in
//     Chrome, fine in Node, so the debounce never fired and nothing analyzed.
//   • `[hidden]` losing to `.panel { display: flex }`, so the panel never
//     actually collapsed.
//   • a flex item with `overflow: hidden` collapsing the metrics row to 2px.
//   • the indicator anchored to the editable node rather than the composer
//     surface, so it sat on top of ChatGPT's own toolbar.
//
// Not wired into `npm test`: it needs Playwright and a browser binary.
//
//   npm install --no-save playwright
//   npx playwright install chromium
//   node e2e/run.js                     # every platform and every suite
//   node e2e/run.js --shots ./shots     # also write screenshots
//
// PF_CHROMIUM=/path/to/chrome overrides the browser, for environments that
// already have one installed at a revision Playwright did not download.
//
// The fixture is served BY FULFILLING requests to the real hosts, because the
// content script deliberately refuses to run anywhere else. Nothing is
// requested from the network.

const path = require('path');
const fs = require('fs');
const os = require('os');

const EXT_ROOT = path.resolve(__dirname, '../..');      // dir holding manifest.json
const FIXTURES = path.join(__dirname, 'fixtures');
const shotsFlag = process.argv.indexOf('--shots');
const SHOTS = shotsFlag > -1 ? path.resolve(process.argv[shotsFlag + 1] || './shots') : null;

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  console.error('Playwright is not installed.\n  npm install --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const CHATGPT_PROMPT = [
  'Hi there! I was wondering if you could please help me out with something.',
  'Basically, I would really like you to write a summary of the quarterly report for',
  'Northwind Logistics covering Q3 2024, and I think that it should be under 200 words.',
  'Please do not include any financial projections whatsoever. Use a professional tone.',
  'The report is at https://example.com/q3.pdf and the main contact is Dr. Chen.',
  'In order to make it easier to read, use bullet points. Thank you so much in advance!',
].join(' ');

const CODE_PROMPT = [
  'Refactor this and keep the API identical:',
  '```js',
  'const API_KEY = "sk-test-123";',
  'fetch("https://api.example.com/v1/items?limit=50");',
  '```',
  'Do not rename any variable. Please make sure that the output is a numbered list.',
].join('\n');

const CLAUDE_PROMPT = [
  'Hi Claude! I was wondering if you could please help me out. Basically, I would really',
  'like you to review the migration plan for Contoso Ltd dated 2025-03-14 and, in order to',
  'keep it short, give me under 300 words. Please do not suggest any schema changes.',
  'The doc is at https://example.com/plan.md and the owner is Dr. Alvarez.',
  'Thank you so much in advance!',
].join(' ');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Launch Chromium with the extension loaded and the fixture served as `host`. */
async function open(fixture, host, url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,                    // extensions need a full browser…
    args: [
      '--headless=new',                 // …but the new headless mode supports them
      `--disable-extensions-except=${EXT_ROOT}`,
      `--load-extension=${EXT_ROOT}`,
    ],
    viewport: { width: 1280, height: 800 },
    ...(process.env.PF_CHROMIUM ? { executablePath: process.env.PF_CHROMIUM } : {}),
  });
  const html = fs.readFileSync(path.join(FIXTURES, fixture), 'utf8');
  await ctx.route(`https://${host}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(1300);
  return { ctx, page, errors, cleanup: () => ctx.close().then(() => fs.rmSync(profile, { recursive: true, force: true })) };
}

/** Set the composer's text the way the host editor stores it, then notify it. */
function typeInto(page, selector, text) {
  return page.evaluate(([sel, t]) => {
    const el = document.querySelector(sel);
    el.focus();
    el.innerHTML = t.split('\n').map((l) => `<p>${l || '<br>'}</p>`).join('');
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, [selector, text]);
}

function readComposer(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return Array.from(el.querySelectorAll('p')).map((p) => p.textContent).join('\n') || el.textContent;
  }, selector);
}

/** Boxes that must never be covered: the assistant sits outside the composer. */
function overlaps(page, selectors) {
  return page.evaluate((sels) => {
    const h = document.getElementById('pf-assistant-root').getBoundingClientRect();
    return sels.map((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { sel, hit: !(h.right <= r.left || h.left >= r.right || h.bottom <= r.top || h.top >= r.bottom) };
    });
  }, selectors);
}

async function runChatGPT() {
  console.log('\nChatGPT');
  const { page, errors, cleanup } = await open('chatgpt.html', 'chatgpt.com', 'https://chatgpt.com/');
  const editor = '#prompt-textarea';
  const bar = page.locator('#pf-assistant-root #bar');
  try {
    check('mounts exactly one host', await page.locator('#pf-assistant-root').count() === 1);
    check('hidden while the composer is empty', await page.locator('#pf-assistant-root').isHidden());

    await typeInto(page, editor, CHATGPT_PROMPT);
    await page.waitForTimeout(250);
    const typing = await page.locator('#pf-assistant-root #headline').textContent();
    check('shows a live token count while typing', /tokens/.test(typing), typing);

    await page.waitForTimeout(1200);
    const headline = await page.locator('#pf-assistant-root #headline').textContent();
    check('offers a saving once typing pauses', /Save/.test(headline), headline);
    await shot(page, '01-collapsed-dark');

    const hits = await overlaps(page, ['#composer-background', '[data-testid="send-button"]', '[aria-label="Dictate"]']);
    check('never covers the composer, send, or voice controls', hits.every((h) => !h.hit), JSON.stringify(hits));

    await bar.click();
    await page.waitForTimeout(500);
    check('expands into the comparison panel', await page.locator('#pf-assistant-root #panel').isVisible());
    const original = await page.locator('#pf-assistant-root #pane-original').textContent();
    const optimized = await page.locator('#pf-assistant-root #pane-optimized').textContent();
    check('shows both prompts', original.includes('Northwind') && optimized && optimized !== original);
    const preserved = await page.locator('#pf-assistant-root #preserved-text').textContent();
    check('claims preservation only after validating', /Meaning preserved/.test(preserved));
    await shot(page, '02-expanded-dark');

    const keeps = ['Northwind Logistics', '200 words', 'https://example.com/q3.pdf', 'Dr. Chen', 'Q3 2024'];
    const lost = keeps.filter((k) => !optimized.includes(k));
    check('keeps names, numbers, limits, and links', lost.length === 0, lost.join(', '));
    check('keeps the negation', /do not/i.test(optimized));
    check('stays fully on screen', await page.evaluate(() => {
      const r = document.getElementById('pf-assistant-root').getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    }));

    await page.locator('#pf-assistant-root #act-replace').click();
    await page.waitForTimeout(400);
    check('replace updates the real composer', (await readComposer(page, editor)).trim() === optimized.trim());
    check('offers undo', await page.locator('#pf-assistant-root #toast').isVisible());
    await shot(page, '03-replaced-dark');

    await page.locator('#pf-assistant-root #toast-undo').click();
    await page.waitForTimeout(400);
    check('undo restores the original exactly', (await readComposer(page, editor)).trim() === CHATGPT_PROMPT.trim());

    await page.click('#devbar button:nth-child(1)');           // light mode
    await page.waitForTimeout(600);
    check('follows the page into light mode',
      await page.locator('#pf-assistant-root').getAttribute('data-theme') === 'light');
    await page.waitForTimeout(1000);
    await bar.click();
    await page.waitForTimeout(500);
    await shot(page, '04-expanded-light');
    await bar.click();
    await page.waitForTimeout(400);

    const before = await page.locator('#pf-assistant-root').boundingBox();
    await page.click('#devbar button:nth-child(2)');           // collapse sidebar
    await page.click('#devbar button:nth-child(3)');           // add attachment
    await page.waitForTimeout(700);
    const after = await page.locator('#pf-assistant-root').boundingBox();
    check('re-anchors on sidebar and attachment changes', before.x !== after.x || before.y !== after.y);
    await shot(page, '05-attachment-light');

    await page.setViewportSize({ width: 560, height: 620 });
    await page.waitForTimeout(700);
    check('stays on screen in a narrow window', await page.evaluate(() => {
      const r = document.getElementById('pf-assistant-root').getBoundingClientRect();
      return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
    }));
    await shot(page, '06-narrow');
    await page.setViewportSize({ width: 1280, height: 800 });

    // A genuinely tight prompt — no filler, no repetition, nothing to merge —
    // is the only kind that may be called concise.
    await typeInto(page, editor, 'Summarize this in three bullets.');
    await page.waitForTimeout(1200);
    const short = await page.locator('#pf-assistant-root #headline').textContent();
    check('a genuinely tight prompt reports "Already concise"', /concise/i.test(short), short);

    // …and a padded one never does, however short it is. This is the regression
    // the aggressive-compression rebuild exists to prevent.
    await typeInto(page, editor,
      'Hi! I was wondering if you could please, if it is not too much trouble, basically just help me write a summary? It is very important that you keep it short. Please make sure that you keep it short.');
    await page.waitForTimeout(1300);
    const padded = await page.locator('#pf-assistant-root #headline').textContent();
    check('a padded prompt is never called concise', !/concise/i.test(padded) && /save/i.test(padded), padded);

    // The model is named in the popup, and switching it mid-draft updates the
    // popup in place — no reload, no reopen, no second popup, prompt untouched.
    const pillName = page.locator('#pf-assistant-root #model-name');
    check('the popup names the selected model',
      (await pillName.textContent()).includes('GPT-5.6 Sol'), await pillName.textContent());

    const draftBefore = await readComposer(page, editor);
    await page.click('#devbar button:nth-child(5)');           // switch model
    await page.waitForTimeout(1400);
    check('a model switch updates the popup without a reload',
      (await pillName.textContent()).includes('GPT-5.6 Luna'), await pillName.textContent());
    check('a model switch leaves the prompt alone', await readComposer(page, editor) === draftBefore);
    check('a model switch creates no second popup',
      await page.locator('#pf-assistant-root').count() === 1);

    await page.click('#devbar button:nth-child(6)');           // Auto
    await page.waitForTimeout(1400);
    const autoPill = await pillName.textContent();
    check('Auto is shown as Auto and never resolved into a model name',
      /^Auto/.test(autoPill) && !/Sol|Terra|Luna/.test(autoPill), autoPill);
    await page.click('#devbar button:nth-child(6)');           // back to a real model
    await page.waitForTimeout(1200);

    await typeInto(page, editor, CODE_PROMPT);
    await page.waitForTimeout(1300);
    await bar.click();
    await page.waitForTimeout(400);
    const code = await page.locator('#pf-assistant-root #pane-optimized').textContent();
    check('code, secrets, and query strings survive verbatim',
      code.includes('const API_KEY = "sk-test-123";') &&
      code.includes('https://api.example.com/v1/items?limit=50') &&
      /do not rename/i.test(code));
    await shot(page, '07-code-light');
    await bar.click();
    await page.waitForTimeout(300);

    await page.click('#devbar button:nth-child(4)');           // new conversation
    await page.waitForTimeout(900);
    await typeInto(page, editor, CHATGPT_PROMPT);
    await page.waitForTimeout(1300);
    check('works after switching conversations',
      /Save/.test(await page.locator('#pf-assistant-root #headline').textContent()));
    check('still exactly one host after navigating',
      await page.locator('#pf-assistant-root').count() === 1);

    check('no uncaught errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await cleanup();
  }
}

async function runClaude() {
  console.log('\nClaude');
  const { page, errors, cleanup } = await open('claude.html', 'claude.ai', 'https://claude.ai/new');
  const editor = '.ProseMirror';
  try {
    check('mounts on claude.ai', await page.locator('#pf-assistant-root').count() === 1);

    await typeInto(page, editor, CLAUDE_PROMPT);
    await page.waitForTimeout(1400);
    const headline = await page.locator('#pf-assistant-root #headline').textContent();
    check('offers a saving on Claude', /Save/.test(headline), headline);

    const hits = await overlaps(page, ['.box', '[aria-label="Send message"]', '[aria-label="Upload files"]']);
    check('never covers the Claude composer or its controls', hits.every((h) => !h.hit), JSON.stringify(hits));
    check('dark theme detected from the page',
      await page.locator('#pf-assistant-root').getAttribute('data-theme') === 'dark');
    await shot(page, '10-claude-dark');

    await page.locator('#pf-assistant-root #bar').click();
    await page.waitForTimeout(500);
    const optimized = await page.locator('#pf-assistant-root #pane-optimized').textContent();
    const keeps = ['Contoso Ltd', '2025-03-14', '300 words', 'https://example.com/plan.md', 'Dr. Alvarez'];
    const lost = keeps.filter((k) => !optimized.includes(k));
    check('preserves names, dates, limits, and links', lost.length === 0, lost.join(', '));
    check('preserves the negation', /do not suggest/i.test(optimized));
    await shot(page, '11-claude-expanded');

    await page.locator('#pf-assistant-root #act-replace').click();
    await page.waitForTimeout(500);
    check('replaces text in ProseMirror', (await readComposer(page, editor)).trim() === optimized.trim());

    await page.locator('#pf-assistant-root #toast-undo').click();
    await page.waitForTimeout(400);
    check('undo restores the original exactly', (await readComposer(page, editor)).trim() === CLAUDE_PROMPT.trim());

    await page.click('#dev button');
    await page.waitForTimeout(700);
    check('follows Claude into light mode',
      await page.locator('#pf-assistant-root').getAttribute('data-theme') === 'light');
    await shot(page, '12-claude-light');

    check('no uncaught errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await cleanup();
  }
}

/**
 * The regression suite for the replacement bug.
 *
 * `lexical.html` is a composer that keeps its OWN document model and renders the
 * DOM from it — the shape ChatGPT and Claude actually have. Every assertion here
 * reads `window.getState()` (the model, i.e. what would be sent) rather than the
 * markup, because the failure being guarded against is precisely "the box shows
 * the new prompt and the model still holds the old one".
 */
async function runModelEditor() {
  console.log('\nModel-owning editor (replacement regression)');
  const { page, errors, cleanup } = await open('lexical.html', 'chatgpt.com', 'https://chatgpt.com/');
  const editor = '#prompt-textarea';
  const bar = page.locator('#pf-assistant-root #bar');
  const replaceBtn = page.locator('#pf-assistant-root #act-replace');
  const state = () => page.evaluate(() => window.getState());
  const setState = (t) => page.evaluate((x) => window.setState(x), t);
  const expand = async () => {
    const open2 = await page.locator('#pf-assistant-root #panel').isVisible().catch(() => false);
    if (!open2) { await bar.click(); await page.waitForTimeout(400); }
  };

  try {
    // 1. The core case: the editor's model must carry the new prompt.
    await setState(CHATGPT_PROMPT);
    await page.waitForTimeout(1300);
    await expand();
    const optimized = await page.locator('#pf-assistant-root #pane-optimized').textContent();
    await replaceBtn.click();
    await page.waitForTimeout(400);
    check('editor model holds the optimized prompt', (await state()).trim() === optimized.trim(),
      JSON.stringify((await state()).slice(0, 60)));
    check('DOM and editor model agree', await page.evaluate(() => window.inSync()));

    // 2. Multi-paragraph.
    const multi = [
      'Hi there! I was wondering if you could please help me with the following task.',
      '',
      'Basically, I would really like you to review the Q3 2024 report for Northwind Logistics.',
      'Please do not include any financial projections. Use a professional tone.',
      '',
      'Thank you so much in advance!',
    ].join('\n');
    await setState(multi);
    await page.waitForTimeout(1300);
    await expand();
    const multiOpt = await page.locator('#pf-assistant-root #pane-optimized').textContent();
    await replaceBtn.click();
    await page.waitForTimeout(500);
    const multiState = await state();
    check('multi-paragraph model matches the optimized prompt', multiState.trim() === multiOpt.trim());
    check('paragraph structure survives', multiState.split('\n').length > 1);

    // 3. Editing after analysis must not be overwritten by the stale result.
    await setState(CHATGPT_PROMPT);
    await page.waitForTimeout(1300);
    await expand();
    await setState(`${CHATGPT_PROMPT} IMPORTANT: reply in French.`);
    await page.waitForTimeout(150);                 // still inside the debounce
    const disabled = await replaceBtn.isDisabled();
    await replaceBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    check('Replace is disabled once the prompt drifts', disabled);
    check('text typed after analysis is not discarded',
      (await state()).includes('IMPORTANT: reply in French.'));

    // 4. Rapid consecutive clicks.
    await setState(CHATGPT_PROMPT);
    await page.waitForTimeout(1300);
    await expand();
    const rapidOpt = await page.locator('#pf-assistant-root #pane-optimized').textContent();
    await page.evaluate(() => {
      const b = document.getElementById('pf-assistant-root').shadowRoot.getElementById('act-replace');
      b.click(); b.click(); b.click();
    });
    await page.waitForTimeout(500);
    check('three clicks in a tick replace once', (await state()).trim() === rapidOpt.trim());

    // 5. Repeated identical sentences.
    const repeated = 'Please summarize the report. Keep it under 100 words. '
      + 'Please summarize the report. Do not add any commentary whatsoever. '
      + 'Please summarize the report. Use a professional tone throughout the answer.';
    await setState(repeated);
    await page.waitForTimeout(1300);
    await expand();
    const repeatedOpt = await page.locator('#pf-assistant-root #pane-optimized').textContent();
    await replaceBtn.click();
    await page.waitForTimeout(400);
    const repeatedState = await state();
    check('repeated text: model matches the optimized result exactly',
      repeatedState.trim() === repeatedOpt.trim());
    check('repeated text: every requirement survives',
      /100 words/.test(repeatedState) && /Do not add/i.test(repeatedState));

    // 6. Caret and focus.
    await setState(CHATGPT_PROMPT);
    await page.waitForTimeout(1300);
    await expand();
    await replaceBtn.click();
    await page.waitForTimeout(400);
    const caret = await page.evaluate(() => ({
      caret: window.getCaret(),
      focused: document.activeElement && document.activeElement.id,
      paras: document.querySelectorAll('#prompt-textarea p').length,
    }));
    check('composer keeps focus after replacing', caret.focused === 'prompt-textarea');
    check('caret is collapsed at the end of the new text',
      !!caret.caret && caret.caret.collapsed && caret.caret.p === caret.paras - 1,
      JSON.stringify(caret.caret));

    // 7. Undo.
    await page.locator('#pf-assistant-root #toast-undo').click();
    await page.waitForTimeout(400);
    check('undo restores the exact original in the model',
      (await state()).trim() === CHATGPT_PROMPT.trim());
    check('undo leaves DOM and model in sync', await page.evaluate(() => window.inSync()));

    check('no uncaught errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await cleanup();
  }
}

/**
 * Live model detection, in a real browser.
 *
 * jsdom can prove the scoring and the observation shape; only a real engine can
 * prove that the content script wires the detector to the panel, that a picker
 * change repaints without a reload, and that the estimate on screen carries its
 * evidence badge. The panel is queried through the page's own DOM because the
 * modal is injected as plain elements, not into a shadow root.
 */
async function runModelDetection() {
  console.log('\nLive model detection');
  const { page, errors, cleanup } = await open('chatgpt.html', 'chatgpt.com', 'https://chatgpt.com/c/e2e');
  const panelText = (sel) => page.locator(`#pf-modal-overlay ${sel}`).textContent();
  try {
    // Open the panel (Alt+P is the documented shortcut).
    await page.keyboard.press('Alt+KeyP');
    await page.waitForTimeout(700);
    check('panel opens with a model section', await page.locator('#pf-modal-model').isVisible());
    check('names the detected model', (await panelText('#pf-model-name')).includes('GPT-5.6 Sol'),
      await panelText('#pf-model-name'));
    check('names the provider', (await panelText('#pf-model-provider')).includes('ChatGPT'));

    const badge = await panelText('#pf-model-evidence');
    check('shows an evidence badge, never a bare number', /Assumption|Modelled|Reported|Measured/.test(badge), badge);
    const energy = await panelText('#pf-model-energy');
    check('shows a range, not a single figure', /–/.test(energy) && /Wh/.test(energy), energy);

    // Typing updates the projection without a reload.
    await typeInto(page, '#prompt-textarea', 'Summarize the Q3 report for Northwind Logistics in under 200 words.');
    await page.waitForTimeout(900);
    const tokens = await panelText('#pf-model-tokens');
    check('counts the draft prompt live', Number(tokens) > 0, tokens);

    // Switch the model in the picker: no reload, no navigation.
    await page.click('#devbar button:nth-child(5)');
    await page.waitForTimeout(1200);
    check('reacts to a model switch without reloading',
      (await panelText('#pf-model-name')).includes('GPT-5.6 Luna'), await panelText('#pf-model-name'));
    const changed = await page.locator('#pf-model-change').textContent();
    check('explains why the estimate moved', /Model changed from/.test(changed), changed);
    const lunaEnergy = await panelText('#pf-model-energy');
    check('the projected range actually changed', lunaEnergy !== energy, `${energy} -> ${lunaEnergy}`);
    await shot(page, '20-model-detected');

    // Auto routing must not resolve to a named model.
    await page.click('#devbar button:nth-child(6)');
    await page.waitForTimeout(1200);
    const autoName = await panelText('#pf-model-name');
    check('Auto is reported as Auto, not as a model', /Auto/.test(autoName) && !/GPT-5\.6 (Sol|Luna)/.test(autoName), autoName);

    // The expanded detail view carries the disclosures.
    await page.click('#pf-model-toggle');
    await page.waitForTimeout(300);
    const details = await panelText('#pf-model-details');
    check('details name the detection source and confidence', /Detected via/.test(details) && /Detection confidence/.test(details));
    check('details separate cooling from full-operational water',
      /Water — full operational/.test(details) || /Water — cooling/.test(details), details.slice(0, 200));
    check('details carry the routing disclosure',
      /may route this request dynamically/i.test(details));
    check('details carry the savings caveat',
      /do not imply the same percentage reduction/i.test(details));
    await shot(page, '21-model-details');

    check('no uncaught errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await cleanup();
  }
}

/** The same wiring on Claude, where effort is a separate control from the model. */
async function runClaudeModelDetection() {
  console.log('\nLive model detection — Claude');
  const { page, errors, cleanup } = await open('claude.html', 'claude.ai', 'https://claude.ai/chat/e2e');
  const panelText = (sel) => page.locator(`#pf-modal-overlay ${sel}`).textContent();
  try {
    await page.keyboard.press('Alt+KeyP');
    await page.waitForTimeout(700);
    check('detects the Claude model', (await panelText('#pf-model-name')).includes('Claude Opus 5'),
      await panelText('#pf-model-name'));

    await page.click('#pf-model-toggle');
    await page.waitForTimeout(300);
    const details = await panelText('#pf-model-details');
    check('reads effort separately from the model', /high/i.test(details), details.slice(0, 240));
    check('says Anthropic has published no per-query footprint',
      /Anthropic has not published a per-query footprint/i.test(details));
    // Opus at "high" has no model-specific reasoning band published for that
    // effort level, so it correctly falls back to the generic test-time-scaling
    // distribution — modelled, not measured. Either label is honest here; the
    // one that must never appear is "Measured".
    const claudeBadge = await panelText('#pf-model-evidence');
    check('labels the estimate as an assumption or a model, never as telemetry',
      /Assumption|Modelled/.test(claudeBadge) && !/Measured/.test(claudeBadge), claudeBadge);

    await page.click('#dev button:nth-child(2)');
    await page.waitForTimeout(1200);
    check('switching Opus -> Sonnet is picked up live',
      (await panelText('#pf-model-name')).includes('Claude Sonnet 5'), await panelText('#pf-model-name'));
    await shot(page, '22-claude-model');

    check('no uncaught errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await cleanup();
  }
}

/**
 * The token analyzer, in a real browser.
 *
 * The node:test suite proves the counter, the document analyzer, and the
 * breakdown. Only this proves them against Chrome's own `File`, `DataTransfer`,
 * and `DecompressionStream` — the last of which is what inflates a PDF's
 * content streams, and has no Node-independent equivalent to fall back on.
 */
async function runTokenAnalyzer() {
  console.log('\nToken analyzer');
  const { page, errors, cleanup } = await open('chatgpt.html', 'chatgpt.com', 'https://chatgpt.com/c/tokens');
  const editor = '#prompt-textarea';
  const bar = page.locator('#pf-assistant-root #bar');
  const text = (sel) => page.locator(`#pf-assistant-root ${sel}`).textContent();
  const total = async () => Number((await text('#context-total')).replace(/[^0-9]/g, ''));
  try {
    await typeInto(page, editor, 'Summarize this report and identify the risks');
    await page.waitForTimeout(900);
    await bar.click();
    await page.waitForTimeout(400);

    check('names the provider and model, not just a number',
      /GPT-5\.6 Sol — detected/.test(await text('#context-model')), await text('#context-model'));
    const bare = await total();
    check('a short prompt counts as a short prompt', bare > 0 && bare < 30, String(bare));

    await page.click('#devbar button:nth-child(7)');           // attach pdf
    await page.waitForTimeout(1200);
    const withPdf = await total();
    check('attaching a PDF makes the count jump', withPdf > bare * 100, `${bare} -> ${withPdf}`);
    const rows = await text('#context-rows');
    check('the PDF is named, with its page count', /q3-annual-report\.pdf/.test(rows) && /6 pages/.test(rows), rows);
    check('text and document/visual processing are shown separately',
      /text \d/.test(rows) && /document\/visual/.test(rows), rows);
    check('the total is labelled an estimate, never exact',
      /Estimated/.test(await text('#context-accuracy')) && !/exact/i.test(await text('#context-accuracy')),
      await text('#context-accuracy'));
    check('platform context we cannot see is named but not numbered',
      /system prompt/i.test(await text('#context-unmeasured')), await text('#context-unmeasured'));
    await shot(page, '30-analyzer-pdf');

    // Pasting: the count must move immediately, and the paste must not be
    // counted twice once it is composer text.
    const paste = 'The quarterly summary covers every region and lists each risk. '.repeat(300);
    await page.evaluate((body) => {
      const el = document.getElementById('prompt-textarea');
      const dt = new DataTransfer();
      dt.setData('text/plain', body);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      el.innerHTML = `<p>Summarize this report and identify the risks</p><p>${body}</p>`;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }, paste);
    await page.waitForTimeout(900);
    const withPaste = await total();
    check('a large paste is counted', withPaste > withPdf + 3000, `${withPdf} -> ${withPaste}`);
    const pasteRows = await text('#context-rows');
    check('and broken out as pasted content', /Pasted content/.test(pasteRows), pasteRows);
    check('the lines sum to the headline (nothing counted twice)',
      await page.evaluate(() => {
        const root = document.getElementById('pf-assistant-root').shadowRoot;
        const shown = Number(root.getElementById('context-total').textContent.replace(/[^0-9]/g, ''));
        const rowsSum = Array.from(root.querySelectorAll('.context-row-value'))
          .map((n) => Number(n.textContent.replace(/[^0-9]/g, '')) || 0)
          .reduce((a, b) => a + b, 0);
        return shown === rowsSum;
      }));

    // Removing the attachment must take its tokens with it — all of them, and
    // only them.
    await page.click('#devbar button:nth-child(8)');           // detach pdf
    await page.waitForTimeout(1200);
    const removed = await total();
    check('removing the PDF removes exactly its tokens',
      Math.abs((withPaste - removed) - withPdf + bare) < 50, `${withPaste} -> ${removed}`);
    check('and the file is gone from the breakdown',
      !/q3-annual-report\.pdf/.test(await text('#context-rows')));

    // A model switch re-costs everything with the other tokenizer. The panel is
    // collapsed first: expanded, it covers the fixture's dev controls.
    await bar.click();
    await page.waitForTimeout(400);
    await page.click('#devbar button:nth-child(6)');           // Auto
    await page.waitForTimeout(1400);
    await bar.click();
    await page.waitForTimeout(400);
    check('Auto never resolves into a model in the analyzer',
      /Auto — exact routed model unavailable/.test(await text('#context-model')), await text('#context-model'));
    await shot(page, '31-analyzer-auto');

    check('no uncaught errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await cleanup();
  }
}

/** The same analyzer on Claude, where the tokenizer is a different one. */
async function runClaudeTokenAnalyzer() {
  console.log('\nToken analyzer — Claude');
  const { page, errors, cleanup } = await open('claude.html', 'claude.ai', 'https://claude.ai/chat/tokens');
  const text = (sel) => page.locator(`#pf-assistant-root ${sel}`).textContent();
  try {
    await typeInto(page, '.ProseMirror', CLAUDE_PROMPT);
    await page.waitForTimeout(1300);
    await page.locator('#pf-assistant-root #bar').click();
    await page.waitForTimeout(400);
    check('names the Claude model in the analyzer',
      /Claude Opus 5 — detected/.test(await text('#context-model')), await text('#context-model'));
    const claudeTotal = Number((await text('#context-total')).replace(/[^0-9]/g, ''));
    check('counts the prompt with Claude’s tokenizer, not one generic ratio',
      claudeTotal > CLAUDE_PROMPT.length / 3,
      `${claudeTotal} tokens for ${CLAUDE_PROMPT.length} characters`);
    check('and shows a share of Claude’s documented context window',
      /% of context/.test(await page.locator('#pf-assistant-root #context-window').textContent()));
    await shot(page, '32-analyzer-claude');
    check('no uncaught errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await cleanup();
  }
}

(async () => {
  await runChatGPT();
  await runClaude();
  await runModelEditor();
  await runModelDetection();
  await runClaudeModelDetection();
  await runTokenAnalyzer();
  await runClaudeTokenAnalyzer();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => {
  console.error('harness error:', err);
  process.exit(2);
});
