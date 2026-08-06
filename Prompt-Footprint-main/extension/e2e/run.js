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
//   node e2e/run.js                     # both platforms
//   node e2e/run.js --shots ./shots     # also write screenshots
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

    await typeInto(page, editor, 'Summarize this in three bullets.');
    await page.waitForTimeout(1200);
    const short = await page.locator('#pf-assistant-root #headline').textContent();
    check('short prompts report "Already concise"', /concise/i.test(short), short);

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

(async () => {
  await runChatGPT();
  await runClaude();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => {
  console.error('harness error:', err);
  process.exit(2);
});
