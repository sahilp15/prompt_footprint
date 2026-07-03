const test = require('node:test');
const assert = require('node:assert');

// background.js is a service worker script (uses importScripts + the chrome.*
// global), not a CommonJS module. We load it once with a minimal chrome/fetch
// stub so its IMPROVE_WRITING handler — the writing-assistant's Gemini/Worker
// integration — can be exercised directly under Node. This only touches the
// IMPROVE_WRITING path; GET_USER_ID/REGISTER_SESSION/END_SESSION (tracking,
// session-saving) are left completely alone.
//
// The writing layer is now rate-limited (token bucket + cooldown + cache), so we
// reset that cross-request state before each case via the test-only hook.

global.self = global;            // background.js is a service worker; it uses `self`
global.importScripts = () => {}; // no-op: we provide the globals it expects below
global.PFProxyConfig = require('../lib/proxyConfig.js');
global.PFAiClient = require('../lib/aiClient.js');

let storedConfig = {};
global.PFStorage = {
  getConfig: async () => storedConfig,
  getUserId: async () => 'test-user',
};

// In-memory chrome.storage.local so the AI stats counter has somewhere to write.
const localStore = {};
let registeredListener = null;
global.chrome = {
  runtime: {
    id: 'test-extension-id',
    onInstalled: { addListener() {} },
    onMessage: { addListener(fn) { registeredListener = fn; } },
    openOptionsPage() {},
  },
  alarms: { create() {}, onAlarm: { addListener() {} } },
  tabs: { onRemoved: { addListener() {} } },
  storage: {
    session: { set() {}, get() {} },
    local: {
      get(keys, cb) {
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in localStore) out[k] = localStore[k]; });
        cb(out);
      },
      set(obj, cb) { Object.assign(localStore, obj); cb && cb(); },
    },
  },
};

require('../background.js');

test.beforeEach(() => {
  storedConfig = {};
  for (const k of Object.keys(localStore)) delete localStore[k];
  if (typeof self !== 'undefined' && self.__pfResetAiState) self.__pfResetAiState();
});

function sendMessage(message, senderId = 'test-extension-id') {
  return new Promise((resolve) => {
    registeredListener(message, { id: senderId }, resolve);
  });
}

const BAD_INPUT = "I receive the files but i don't know what to do next. can you make this promtp good and make sure it has bullet points- first fix the spell checker because it is not working- make the capsule moveable anywere on the screen- don't break chatgpt or claude tracking- add a privacy polciy section- make the github repo look profesional- make the readme betteralso make this **realy important part** more clear and don't mess up the bold text.";
const okResp = (improved) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ improved, rewritten: improved }) });

test('IMPROVE_WRITING with no proxy/key resolves to "" and never hits the network', async () => {
  global.fetch = async () => { throw new Error('must not be called'); };
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(res.improved, '');
  assert.strictEqual(res.status, 'unconfigured');
});

test('a configured Worker is NOT called unless cloud analysis is opted in', async () => {
  // Provider configured, but the user has not enabled cloud analysis.
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev' };
  let called = false;
  global.fetch = async () => { called = true; return okResp('nope'); };
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(called, false, 'draft text must not be sent without opt-in');
  assert.strictEqual(res.improved, '');
  assert.strictEqual(res.status, 'unconfigured');
});

test('IMPROVE_WRITING uses the configured Worker when available (provider selection)', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev', cloudAnalysisEnabled: true };
  let calledUrl = null;
  let calledBody = null;
  const improvedText = 'I received the files, but I do not know what to do next.';
  global.fetch = async (url, opts) => {
    calledUrl = url;
    calledBody = JSON.parse(opts.body);
    return okResp(improvedText);
  };
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(calledUrl, storedConfig.proxyUrl);
  assert.strictEqual(calledBody.mode, 'improve');
  assert.strictEqual(calledBody.text, BAD_INPUT);
  assert.strictEqual(res.improved, improvedText);
  assert.strictEqual(res.status, 'success');
});

test('a 429 falls back to "" (local-only) and does NOT retry-hammer the network', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev', cloudAnalysisEnabled: true };
  let calls = 0;
  global.fetch = async () => { calls += 1; return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: 'Rate limit exceeded' }) }; };
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(res.improved, '');
  assert.strictEqual(res.status, 'rate_limited');
  assert.strictEqual(calls, 1, 'a 429 must not be retried immediately');
});

test('after a 429, further requests cool down without touching the network', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev', cloudAnalysisEnabled: true };
  let calls = 0;
  global.fetch = async () => { calls += 1; return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) }; };
  await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } }); // triggers cooldown
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT + ' more' } });
  assert.strictEqual(res.status, 'cooldown');
  assert.strictEqual(calls, 1, 'the cooldown must prevent a second network call');
});

test('a repeated identical draft is served from cache (no second network call)', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev', cloudAnalysisEnabled: true };
  let calls = 0;
  global.fetch = async () => { calls += 1; return okResp('improved once'); };
  const a = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  const b = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(a.status, 'success');
  assert.strictEqual(b.status, 'cached');
  assert.strictEqual(b.improved, 'improved once');
  assert.strictEqual(calls, 1);
});

test('a Worker timeout (AbortError) is swallowed as a graceful "" error', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev', cloudAnalysisEnabled: true };
  global.fetch = async (url, opts) => {
    assert.ok(opts.signal, 'fetch must be called with an AbortSignal so it can time out');
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(res.improved, '');
  assert.strictEqual(res.status, 'error');
});

test('a malformed JSON body degrades to "" (success status, empty text)', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev', cloudAnalysisEnabled: true };
  global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error('bad json'); } });
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(res.improved, '');
});

test('GET_AI_STATS reports a truthful success rate (unconfigured never counts as failure)', async () => {
  // One real success, then a bunch of unconfigured no-ops.
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev', cloudAnalysisEnabled: true };
  global.fetch = async () => okResp('ok');
  await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  storedConfig = {}; // unconfigured
  await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: 'another draft entirely' } });
  const res = await sendMessage({ type: 'GET_AI_STATS' });
  assert.strictEqual(res.stats.attempts, 1);
  assert.strictEqual(res.stats.success, 1);
  assert.strictEqual(res.successRate, 1); // 100%, not dragged to 50% by the no-op
});

test('unauthorized sender is rejected and the network is never called', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev', cloudAnalysisEnabled: true };
  let called = false;
  global.fetch = async () => { called = true; return okResp('x'); };
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } }, 'some-other-extension');
  assert.strictEqual(called, false);
  assert.ok(res.error);
});
