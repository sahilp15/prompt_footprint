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
