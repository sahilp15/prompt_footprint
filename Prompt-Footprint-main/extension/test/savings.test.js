const test = require('node:test');
const assert = require('node:assert');
const O = require('../lib/promptOptimizer.js');
const S = require('../lib/spellChecker.js');
const Storage = require('../lib/storage.js');

// In-memory chrome.storage.local mock so storage.js's addSavings/getSavings
// (which the dashboard's Savings tab and the content script both read/write
// through the same `pf_savings` key) can be exercised exactly as they run in
// the extension, without a real browser.
function installChromeMock() {
  const backing = {};
  global.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          if (keys === null || keys === undefined) {
            Object.assign(out, backing);
          } else {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) if (k in backing) out[k] = backing[k];
          }
          cb(out);
        },
        set(obj, cb) {
          Object.assign(backing, obj);
          cb();
        },
      },
    },
  };
  return backing;
}

// Mirrors content.js's applyWritingText(): apply a suggestion, compute
// savings, and only record them if the text actually changed and the
// savings are non-trivial — the same guard that prevents double-counting
// when the same suggestion is "accepted" again after it no longer applies.
async function simulateAccept(beforeText, sug, platform) {
  const afterText = S.applyOne(beforeText, sug);
  if (afterText === beforeText) return afterText; // no-op guard
  const s = O.savings(beforeText, afterText, platform);
  if (s.changed && s.savedTokens >= 1) await Storage.addSavings(s);
  return afterText;
}

test('filler-word detection: catches the documented filler words', () => {
  const text = 'basically I just really want to actually make this prompt very good';
  const hits = O.detectFiller(text).map((s) => s.original.toLowerCase());
  for (const w of ['basically', 'just', 'really', 'actually', 'very']) {
    assert.ok(hits.includes(w), `expected "${w}" to be flagged as filler`);
  }
});

test('filler-word detection: "like", "kind of", "sort of" are flagged', () => {
  const hits = O.detectFiller('this is like kind of sort of done').map((s) => s.original.toLowerCase());
  assert.ok(hits.includes('like'));
  assert.ok(hits.includes('kind of'));
  assert.ok(hits.includes('sort of'));
});

test('filler-word detection: "I think" / "I believe" hedges are flagged', () => {
  const hits = O.detectFiller('I think this works and I believe it is correct');
  assert.ok(hits.some((s) => /i think/i.test(s.original)));
  assert.ok(hits.some((s) => /i believe/i.test(s.original)));
});

test('safe phrase replacements: "in order to" -> "to", "due to the fact that" -> "because", "at this point in time" -> "now"', () => {
  const hits = O.detectFiller('in order to win, due to the fact that it matters, at this point in time');
  const byOriginal = Object.fromEntries(hits.map((s) => [s.original.toLowerCase(), s.suggestion]));
  assert.strictEqual(byOriginal['in order to'], 'to');
  assert.strictEqual(byOriginal['due to the fact that'], 'because');
  assert.strictEqual(byOriginal['at this point in time'], 'now');
});

test('filler suggestions are advisory (safe: false) — never forced corrections', () => {
  const hits = O.detectFiller('basically this is very good');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((s) => s.safe === false));
});

test('filler detection does not flag content words or change meaning by itself (detection only mutates nothing)', () => {
  const text = 'Summarize the quarterly report and highlight risks.';
  assert.deepStrictEqual(O.detectFiller(text), []);
});

test('filler detection deduplicates repeated occurrences of the same filler word', () => {
  const hits = O.detectFiller('really really really good');
  const reallyHits = hits.filter((s) => s.original.toLowerCase() === 'really');
  assert.strictEqual(reallyHits.length, 1);
});

test('spell-checking and filler suggestions stay separate types in analyzeWriting()', () => {
  const res = S.analyzeWriting('I recieve teh files but i just really want this.', { typo: null });
  const types = new Set(res.suggestions.map((s) => s.type));
  assert.ok(types.has('spelling'));
  assert.ok(types.has('filler'));
  // Filler suggestions must never leak into the deterministic spelling-only
  // safe-fix text, and must not count toward safeCount (advisory only).
  assert.match(res.safeFixedText, /\bjust\b/, 'safeFixedText must not strip filler words');
  assert.match(res.safeFixedText, /\breally\b/, 'safeFixedText must not strip filler words');
  const fillerSuggestions = res.suggestions.filter((s) => s.type === 'filler');
  assert.ok(fillerSuggestions.every((s) => s.safe === false));
});

test('applyOne on a filler suggestion removes it cleanly (no double space, sentence still capitalized)', () => {
  const out = S.applyOne('I just really want this.', { type: 'filler', original: 'just', suggestion: '', reason: 'x', safe: false });
  assert.strictEqual(out, 'I really want this.');
});

test('applyOne on a phrase-replacement filler suggestion substitutes the concise form', () => {
  const out = S.applyOne('I want to do this in order to win.', { type: 'filler', original: 'in order to', suggestion: 'to', reason: 'x', safe: false });
  assert.strictEqual(out, 'I want to do this to win.');
});

test('applyOne is idempotent: accepting the same filler suggestion twice only changes text once', () => {
  const sug = { type: 'filler', original: 'just', suggestion: '', reason: 'x', safe: false };
  const once = S.applyOne('I just really want this.', sug);
  const twice = S.applyOne(once, sug);
  assert.strictEqual(twice, once);
});

test('accepting a suggestion records realized token savings', async () => {
  installChromeMock();
  const sug = { type: 'filler', original: 'in order to', suggestion: 'to', reason: 'x', safe: false };
  await simulateAccept('I want to do this in order to win.', sug, 'chatgpt');
  const totals = await Storage.getSavings();
  assert.strictEqual(totals.applyCount, 1);
  assert.ok(totals.totalTokensSaved > 0);
});

test('savings are NOT double-counted when the same suggestion is "accepted" again after it no longer applies', async () => {
  installChromeMock();
  const sug = { type: 'filler', original: 'just', suggestion: '', reason: 'x', safe: false };
  let text = 'I just really want this.';
  text = await simulateAccept(text, sug, 'chatgpt'); // removes "just" -> recorded once
  text = await simulateAccept(text, sug, 'chatgpt'); // "just" already gone -> no-op, not recorded again
  const totals = await Storage.getSavings();
  assert.strictEqual(totals.applyCount, 1, `expected exactly one recorded apply, got ${totals.applyCount}`);
});

test('realized savings persist in chrome.storage.local and survive re-reading ("reload")', async () => {
  const backing = installChromeMock();
  const sug = { type: 'filler', original: 'really', suggestion: '', reason: 'x', safe: false };
  await simulateAccept('This is really good.', sug, 'chatgpt');

  // Reads the same chrome.storage.local key the dashboard's Savings tab uses
  // (stats-site/src/lib/api.js: fetchSavings() reads `pf_savings` directly),
  // proving the data is actually persisted to storage, not just in memory.
  assert.ok(backing.pf_savings, 'pf_savings key should be written to chrome.storage.local');
  assert.strictEqual(backing.pf_savings.applyCount, 1);

  // A fresh getSavings() call (as a freshly-opened dashboard page would do)
  // reads it back correctly — storage.js never caches in module state.
  const reread = await Storage.getSavings();
  assert.strictEqual(reread.applyCount, 1);
  assert.ok(reread.totalTokensSaved > 0);
});

test('savings dashboard data source: multiple accepted suggestions accumulate correctly', async () => {
  installChromeMock();
  await simulateAccept('I just want this.', { type: 'filler', original: 'just', suggestion: '', reason: 'x', safe: false }, 'chatgpt');
  await simulateAccept('I want to do this in order to win.', { type: 'filler', original: 'in order to', suggestion: 'to', reason: 'x', safe: false }, 'chatgpt');
  const totals = await Storage.getSavings();
  assert.strictEqual(totals.applyCount, 2);
  assert.ok(totals.totalTokensSaved >= 2);
  // Today's daily bucket should reflect both applies (used by the dashboard chart).
  const today = new Date().toISOString().slice(0, 10);
  assert.strictEqual(totals.daily[today].count, 2);
});
