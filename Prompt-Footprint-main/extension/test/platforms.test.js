const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/platforms.js');

function adapter(id) {
  return P.ADAPTERS.find((a) => a.id === id);
}

test('getActiveAdapter resolves hosts to the right platform', () => {
  assert.strictEqual(P.getActiveAdapter('chatgpt.com')?.id, 'chatgpt');
  assert.strictEqual(P.getActiveAdapter('chat.openai.com')?.id, 'chatgpt');
  assert.strictEqual(P.getActiveAdapter('claude.ai')?.id, 'claude');
  assert.strictEqual(P.getActiveAdapter('www.example.com'), null);
});

test('chatgpt adapter reads role and message id from attributes', () => {
  const el = {
    dataset: {},
    getAttribute: (k) => ({ 'data-message-author-role': 'user', 'data-message-id': 'abc123' }[k] || null),
  };
  const cg = adapter('chatgpt');
  assert.strictEqual(cg.getRole(el), 'user');
  assert.strictEqual(cg.getMessageId(el), 'abc123');
});

test('chatgpt adapter assigns a fallback id when none present', () => {
  const el = { dataset: {}, getAttribute: () => null };
  const id = adapter('chatgpt').getMessageId(el);
  assert.ok(typeof id === 'string' && id.startsWith('pf-'));
  // stable across calls
  assert.strictEqual(adapter('chatgpt').getMessageId(el), id);
});

test('claude adapter derives role from selectors', () => {
  const cl = adapter('claude');
  const userEl = { matches: (s) => s.includes('user-message') };
  const asstEl = { matches: (s) => s.includes('font-claude-message') };
  const otherEl = { matches: () => false, closest: () => null };
  assert.strictEqual(cl.getRole(userEl), 'user');
  assert.strictEqual(cl.getRole(asstEl), 'assistant');
  assert.strictEqual(cl.getRole(otherEl), null);
});

// Minimal document stub so the DOM-based adapter methods can be unit-tested.
function withFakeDom(matchers, fn) {
  const prev = global.document;
  global.document = {
    querySelector(sel) { return matchers[sel] ? matchers[sel]() : null; },
    querySelectorAll(sel) { const el = matchers[sel] && matchers[sel](); return el ? [el] : []; },
  };
  try { return fn(); } finally { global.document = prev; }
}

test('chatgpt.isGenerating: true when a stop button exists, false otherwise', () => {
  const cg = adapter('chatgpt');
  withFakeDom({ [cg.stopSelector]: () => ({}) }, () => {
    assert.strictEqual(cg.isGenerating(), true);
    assert.strictEqual(cg.generatingSignal(), 'stop-button');
  });
  withFakeDom({}, () => {
    assert.strictEqual(cg.isGenerating(), false);
    assert.strictEqual(cg.generatingSignal(), null);
  });
});

test('chatgpt.isGenerating: detects result-streaming when no stop button', () => {
  const cg = adapter('chatgpt');
  withFakeDom({ '.result-streaming, [data-message-author-role="assistant"] .result-streaming': () => ({}) }, () => {
    assert.strictEqual(cg.generatingSignal(), 'result-streaming');
    assert.strictEqual(cg.isGenerating(), true);
  });
});

test('chatgpt.isComplete: only when text + toolbar present and not generating', () => {
  const cg = adapter('chatgpt');
  // No assistant element at all → not complete.
  withFakeDom({}, () => assert.strictEqual(cg.isComplete(), false));

  // Assistant with text + copy toolbar, no stop signal → complete.
  const turn = {
    querySelector: (s) => (/copy/i.test(s) ? {} : null),
  };
  const assistantEl = {
    cloneNode: () => ({ querySelectorAll: () => [], textContent: 'final answer' }),
    closest: () => turn,
    parentElement: turn,
  };
  withFakeDom({ '[data-message-author-role="assistant"]': () => assistantEl }, () => {
    assert.strictEqual(cg.isComplete(), true);
  });

  // Same element but generating (stop button present) → not complete.
  withFakeDom({
    '[data-message-author-role="assistant"]': () => assistantEl,
    [cg.stopSelector]: () => ({}),
  }, () => {
    assert.strictEqual(cg.isComplete(), false);
  });
});

test('isResponseComplete decision table', () => {
  const f = P.isResponseComplete;
  // generating → never complete
  assert.strictEqual(f({ generating: true, hasText: true, stableMs: 9999, settleMs: 2000, completeSignal: true }), false);
  // no text → not complete
  assert.strictEqual(f({ generating: false, hasText: false, stableMs: 9999, settleMs: 2000, completeSignal: true }), false);
  // positive complete signal + text + not generating → complete
  assert.strictEqual(f({ generating: false, hasText: true, stableMs: 0, settleMs: 2000, completeSignal: true }), true);
  // no signal, stable long enough → complete
  assert.strictEqual(f({ generating: false, hasText: true, stableMs: 2500, settleMs: 2000, completeSignal: false }), true);
  // no signal, not yet stable → not complete
  assert.strictEqual(f({ generating: false, hasText: true, stableMs: 500, settleMs: 2000, completeSignal: false }), false);
});

test('every adapter exposes the required interface', () => {
  for (const a of P.ADAPTERS) {
    for (const key of ['id', 'name', 'hostMatches', 'rootSelector', 'messageSelector', 'inputSelector']) {
      assert.ok(a[key] !== undefined, `${a.id} missing ${key}`);
    }
    for (const fn of ['getRole', 'getMessageId', 'getLatestAssistant', 'extractText']) {
      assert.strictEqual(typeof a[fn], 'function', `${a.id}.${fn} not a function`);
    }
  }
});
