const test = require('node:test');
const assert = require('node:assert');

// background.js is a service worker script (uses importScripts + the chrome.*
// global), not a CommonJS module. We load it once with a minimal chrome/fetch
// stub so its IMPROVE_WRITING handler — the writing-assistant's Gemini/Worker
// integration — can be exercised directly under Node. This only touches the
// IMPROVE_WRITING path; GET_USER_ID/REGISTER_SESSION/END_SESSION (tracking,
// session-saving) are left completely alone.

global.importScripts = () => {}; // no-op: we provide the globals it expects below
global.PFProxyConfig = require('../lib/proxyConfig.js');

let storedConfig = {};
global.PFStorage = {
  getConfig: async () => storedConfig,
  getUserId: async () => 'test-user',
};

let registeredListener = null;
global.chrome = {
  runtime: {
    id: 'test-extension-id',
    onInstalled: { addListener() {} },
    onMessage: { addListener(fn) { registeredListener = fn; } },
    openOptionsPage() {},
  },
  tabs: { onRemoved: { addListener() {} } },
  storage: { session: { set() {}, get() {} } },
};

require('../background.js');

function sendMessage(message) {
  return new Promise((resolve) => {
    registeredListener(message, { id: 'test-extension-id' }, resolve);
  });
}

const BAD_INPUT = "I receive the files but i don't know what to do next. can you make this promtp good and make sure it has bullet points- first fix the spell checker because it is not working- make the capsule moveable anywere on the screen- don't break chatgpt or claude tracking- add a privacy polciy section- make the github repo look profesional- make the readme betteralso make this **realy important part** more clear and don't mess up the bold text.";

test('IMPROVE_WRITING with no proxy/key configured resolves to "" (local-only signal)', async () => {
  storedConfig = {};
  global.fetch = async () => { throw new Error('must not be called'); };
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(res.improved, '');
});

test('IMPROVE_WRITING uses the configured Worker when available (provider selection)', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev' };
  let calledUrl = null;
  let calledBody = null;
  const improvedText = 'I received the files, but I do not know what to do next.';
  global.fetch = async (url, opts) => {
    calledUrl = url;
    calledBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ improved: improvedText, rewritten: improvedText }) };
  };
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(calledUrl, storedConfig.proxyUrl);
  assert.strictEqual(calledBody.mode, 'improve');
  assert.strictEqual(calledBody.text, BAD_INPUT);
  assert.strictEqual(res.improved, improvedText);
});

test('IMPROVE_WRITING falls back to "" when the Worker returns a non-OK response', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev' };
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: 'Rate limit exceeded' }) });
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(res.improved, '');
});

test('IMPROVE_WRITING falls back to "" when the Worker fetch is aborted (timeout path)', async () => {
  // handleAiRequest wraps the Worker fetch with fetchWithTimeout (AbortController);
  // an aborted/timed-out fetch throws AbortError, which must be swallowed the
  // same as any other network failure rather than hanging the UI.
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev' };
  global.fetch = async (url, opts) => {
    assert.ok(opts.signal, 'fetch must be called with an AbortSignal so it can time out');
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(res.improved, '');
});

test('IMPROVE_WRITING falls back to "" when the Worker network call throws', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev' };
  global.fetch = async () => { throw new Error('network down'); };
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(res.improved, '');
});

test('IMPROVE_WRITING falls back to "" when the Worker returns malformed JSON', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev' };
  global.fetch = async () => ({ ok: true, json: async () => { throw new Error('bad json'); } });
  const res = await sendMessage({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } });
  assert.strictEqual(res.improved, '');
});

test('unauthorized sender is rejected and Gemini is never called', async () => {
  storedConfig = { proxyUrl: 'https://promptfootprint-proxy.example.workers.dev' };
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const res = await new Promise((resolve) => {
    registeredListener({ type: 'IMPROVE_WRITING', payload: { text: BAD_INPUT } }, { id: 'some-other-extension' }, resolve);
  });
  assert.strictEqual(called, false);
  assert.ok(res.error);
});
