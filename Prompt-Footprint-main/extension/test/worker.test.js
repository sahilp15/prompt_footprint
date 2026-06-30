const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// proxy/worker.js is the Cloudflare Worker that fronts Gemini for the "improve"
// (writing assistant) and "shorten" modes. It's a plain ESM module exporting
// { fetch(request, env) }, so it can be loaded and unit-tested directly under
// Node by stubbing the global `fetch` it uses to call the Gemini API.
const workerPromise = import(path.join(__dirname, '../../proxy/worker.js'));

// The exact input from the failed real-Chrome writing-assistant test.
const BAD_INPUT = "I receive the files but i don't know what to do next. can you make this promtp good and make sure it has bullet points- first fix the spell checker because it is not working- make the capsule moveable anywere on the screen- don't break chatgpt or claude tracking- add a privacy polciy section- make the github repo look profesional- make the readme betteralso make this **realy important part** more clear and don't mess up the bold text.";

// The polished rewrite a correctly-prompted Gemini call should produce. Used
// as the canned upstream response so we can verify the Worker's plumbing
// (request shape, system prompt, response shaping) without depending on a
// live Gemini API call.
const EXPECTED_IMPROVED = `I received the files, but I don't know what to do next. Can you make this prompt good and make sure it has bullet points?

- First, fix the spell checker because it is not working.
- Make the capsule movable anywhere on the screen.
- Don't break ChatGPT or Claude tracking.
- Add a privacy policy section.
- Make the GitHub repo look professional.

Also, make this **really important part** more clear, and don't mess up the bold text.`;

function geminiResponse(text) {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
  };
}

async function callImprove(env, fetchStub) {
  const { default: worker } = await workerPromise;
  const original = global.fetch;
  global.fetch = fetchStub;
  try {
    const request = new Request('https://proxy.example.workers.dev/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://chatgpt.com' },
      body: JSON.stringify({ text: BAD_INPUT, mode: 'improve' }),
    });
    return await worker.fetch(request, env);
  } finally {
    global.fetch = original;
  }
}

test('Worker (Gemini mock): returns the improved text with paragraphs/bullets restored', async () => {
  let capturedBody = null;
  const fetchStub = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return new Response(JSON.stringify(geminiResponse(EXPECTED_IMPROVED)), { status: 200 });
  };
  const res = await callImprove({ GEMINI_API_KEY: 'test-key' }, fetchStub);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.improved, EXPECTED_IMPROVED);
  assert.strictEqual(data.rewritten, EXPECTED_IMPROVED); // back-compat alias

  // Paragraph spacing and bullets restored.
  assert.ok(/\n\n-/.test(data.improved), 'expected a blank line before the bullet list');
  assert.match(data.improved, /- First, fix the spell checker/);
  assert.match(data.improved, /- Make the capsule movable anywhere on the screen\./);
  assert.match(data.improved, /- Don't break ChatGPT or Claude tracking\./);
  assert.match(data.improved, /- Add a privacy policy section\./);
  assert.match(data.improved, /- Make the GitHub repo look professional\./);

  // Specific typo / capitalization fixes from the bad input.
  assert.match(data.improved, /\bprompt\b/);
  assert.match(data.improved, /\banywhere\b/);
  assert.match(data.improved, /\bpolicy\b/);
  assert.match(data.improved, /\bprofessional\b/);
  assert.match(data.improved, /\breally\b/);
  assert.match(data.improved, /\bAlso,/); // "betteralso" split into "better. Also"
  assert.match(data.improved, /^I received/); // sentence-start capitalization

  // Markdown bold survives exactly.
  assert.ok(data.improved.includes('**really important part**'),
    'bold markdown around "really important part" must survive exactly');

  // The system prompt actually sent to Gemini instructs bullet/markdown/joined-word handling.
  const sentSystem = capturedBody.systemInstruction.parts[0].text;
  assert.match(sentSystem, /\*\*bold\*\*/);
  assert.match(sentSystem, /bullet list/i);
  assert.match(sentSystem, /run together/i);
});

test('Worker (Gemini mock): upstream failure falls back gracefully (no throw, 502)', async () => {
  const fetchStub = async () => new Response('boom', { status: 500 });
  const res = await callImprove({ GEMINI_API_KEY: 'test-key' }, fetchStub);
  assert.strictEqual(res.status, 502);
  const data = await res.json();
  assert.ok(data.error);
});

test('Worker (Gemini mock): upstream network error falls back gracefully (no throw, 502)', async () => {
  const fetchStub = async () => { throw new Error('network down'); };
  const res = await callImprove({ GEMINI_API_KEY: 'test-key' }, fetchStub);
  assert.strictEqual(res.status, 502);
  const data = await res.json();
  assert.ok(data.error);
});

test('Worker: missing server config (no key) fails closed without calling Gemini', async () => {
  let called = false;
  const fetchStub = async () => { called = true; return new Response('{}', { status: 200 }); };
  const res = await callImprove({}, fetchStub);
  assert.strictEqual(res.status, 500);
  assert.strictEqual(called, false);
});
