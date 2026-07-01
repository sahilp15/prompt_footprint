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
// A matcher may return a single element (→ querySelectorAll yields [el]) or an
// array of elements (→ querySelectorAll yields the array, for count-based logic).
function withFakeDom(matchers, fn) {
  const prev = global.document;
  const get = (sel) => (matchers[sel] ? matchers[sel]() : null);
  global.document = {
    querySelector(sel) { const r = get(sel); return Array.isArray(r) ? (r[0] || null) : (r || null); },
    querySelectorAll(sel) { const r = get(sel); return Array.isArray(r) ? r : (r ? [r] : []); },
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

// ── Claude "records but never saves" bug ────────────────────────────────────
// Root cause: getLatestAssistant()/latestTurnComplete() relied on the stale
// `.font-claude-message` container, which Claude's live DOM no longer renders.
// Verified hooks: answer text is <p class="font-claude-response-body">, and a
// finished turn renders an action bar with the assistant-only Retry button
// (button[data-testid="action-bar-retry"]). Each user turn yields one answer,
// so the latest turn is complete once Retry count >= user-turn count.
const CLAUDE_USER = '[data-testid="user-message"]';
const CLAUDE_RESP = 'p.font-claude-response-body';
const CLAUDE_RETRY = 'button[data-testid="action-bar-retry"]';
function claudeAssistantEl(text = 'final answer') {
  return { cloneNode: () => ({ querySelectorAll: () => [], textContent: text }) };
}

test('claude reads answer text from p.font-claude-response-body (not .font-claude-message)', () => {
  const cl = adapter('claude');
  // Live DOM exposes no legacy container — only response-body paragraphs.
  withFakeDom({ [CLAUDE_RESP]: () => [claudeAssistantEl('hello world')] }, () => {
    const latest = cl.getLatestAssistant();
    assert.ok(latest, 'getLatestAssistant must find the response-body paragraph');
    assert.strictEqual(cl.extractText(latest), 'hello world');
  });
});

test('claude does NOT save while streaming (stop button up, no action bar yet)', () => {
  const cl = adapter('claude');
  withFakeDom({
    [cl.stopSelector]: () => ({}),
    [CLAUDE_USER]: () => [{}],
    [CLAUDE_RESP]: () => [claudeAssistantEl('partial')],
    // no Retry button yet
  }, () => {
    assert.strictEqual(cl.generatingSignal(), 'stop-button');
    assert.strictEqual(cl.isGenerating(), true);
    assert.strictEqual(cl.isComplete(), false);
    assert.strictEqual(
      P.isResponseComplete({ generating: true, hasText: true, stableMs: 9999, settleMs: 2000, completeSignal: false }),
      false,
    );
  });
});

test('claude does NOT save while thinking/streaming (data-is-streaming, action bar not rendered)', () => {
  const cl = adapter('claude');
  withFakeDom({
    '[data-is-streaming="true"]': () => ({}),
    [CLAUDE_USER]: () => [{}],
    [CLAUDE_RESP]: () => [claudeAssistantEl('partial')],
  }, () => {
    assert.strictEqual(cl.latestTurnComplete(), false); // 0 retry < 1 user turn
    assert.strictEqual(cl.generatingSignal(), 'is-streaming');
    assert.strictEqual(cl.isGenerating(), true);
    assert.strictEqual(cl.isComplete(), false);
  });
});

test('claude saves after the completed action bar appears (no stop button)', () => {
  const cl = adapter('claude');
  withFakeDom({
    [CLAUDE_USER]: () => [{}],
    [CLAUDE_RESP]: () => [claudeAssistantEl()],
    [CLAUDE_RETRY]: () => [{}],
  }, () => {
    assert.strictEqual(cl.latestTurnComplete(), true);
    assert.strictEqual(cl.generatingSignal(), null);
    assert.strictEqual(cl.isGenerating(), false);
    assert.strictEqual(cl.isComplete(), true);
    assert.strictEqual(
      P.isResponseComplete({ generating: false, hasText: true, stableMs: 0, settleMs: 2000, completeSignal: true }),
      true,
    );
  });
});

test('claude regression: a lingering data-is-streaming="true" no longer blocks save', () => {
  const cl = adapter('claude');
  // The exact bug: stream attribute stuck true, but the turn finished (Retry
  // present) and the stop button is gone.
  withFakeDom({
    '[data-is-streaming="true"]': () => ({}),
    [CLAUDE_USER]: () => [{}],
    [CLAUDE_RESP]: () => [claudeAssistantEl()],
    [CLAUDE_RETRY]: () => [{}],
  }, () => {
    assert.strictEqual(cl.generatingSignal(), null); // is-streaming suppressed by completion
    assert.strictEqual(cl.isGenerating(), false);
    assert.strictEqual(cl.isComplete(), true);
  });
});

test('claude does not finalize the PREVIOUS turn right after a new submit', () => {
  const cl = adapter('claude');
  // Previous turn complete (1 Retry); a new prompt was just sent so there are 2
  // user turns but only 1 Retry, and the Stop button is up. Both the count
  // (1 < 2) and the authoritative Stop button keep us "generating".
  withFakeDom({
    [cl.stopSelector]: () => ({}),
    [CLAUDE_USER]: () => [{}, {}],
    [CLAUDE_RESP]: () => [claudeAssistantEl(), claudeAssistantEl()],
    [CLAUDE_RETRY]: () => [{}],
  }, () => {
    assert.strictEqual(cl.latestTurnComplete(), false); // 1 retry < 2 user turns
    assert.strictEqual(cl.generatingSignal(), 'stop-button'); // Stop is authoritative too
    assert.strictEqual(cl.isGenerating(), true);
  });
});

test('claude saves exactly once across repeated completed polls', () => {
  // Mirrors content.js pollResponse/finalizeResponse: once a poll finalizes it
  // clears the pending capture (stopResponseWatch) and the lastFinalizedText
  // guard rejects a duplicate, so further completed polls cannot save again.
  const cl = adapter('claude');
  let finalizeCount = 0;
  let lastFinalizedText = '';
  let pending = true;
  const poll = () => {
    if (!pending) return;
    const generating = cl.isGenerating();
    const latest = cl.getLatestAssistant();
    const text = latest ? cl.extractText(latest) : '';
    const done = P.isResponseComplete({
      generating, hasText: !!text, stableMs: 0, settleMs: 2000, completeSignal: cl.isComplete(),
    });
    if (!done) return;
    pending = false; // content.js: stopResponseWatch() + pendingUserMessage = null
    if (text === lastFinalizedText) return; // duplicate guard
    lastFinalizedText = text;
    finalizeCount += 1;
  };
  withFakeDom({
    [CLAUDE_USER]: () => [{}],
    [CLAUDE_RESP]: () => [claudeAssistantEl('answer')],
    [CLAUDE_RETRY]: () => [{}],
  }, () => {
    poll(); poll(); poll(); // three completed ticks
    assert.strictEqual(finalizeCount, 1);
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
