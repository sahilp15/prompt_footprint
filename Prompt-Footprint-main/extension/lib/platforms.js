// PromptFootprint Platform Adapters
// ---------------------------------------------------------------------------
// Abstraction layer that lets PromptFootprint track multiple AI chat platforms
// without the observer logic in content.js needing to know platform specifics.
//
// To add a new platform, append an adapter to ADAPTERS with:
//   id            unique key, also used as the environmental profile key
//   name          human-readable label
//   hostMatches   substrings tested against location.host
//   rootSelector  element to attach the MutationObserver to
//   messageSelector  matches BOTH user and assistant message elements
//   inputSelector    the prompt input box (used by the prompt optimizer)
//   getRole(el)      -> 'user' | 'assistant' | null
//   getMessageId(el) -> stable id string (assigns one if the DOM has none)
//   getLatestAssistant() -> the most recent assistant element, or null
//   extractText(el)  -> plain text of a message element
//
// DOM selectors are inherently brittle (platforms ship UI changes frequently).
// Each adapter keeps fallbacks, and content.js degrades gracefully if a
// selector stops matching. Selectors verified against the live DOM during
// implementation; revisit if a platform restructures its chat markup.

(function (root) {
  'use strict';

  let _idCounter = 0;

  // Shared: strip non-content nodes and return trimmed text.
  function extractText(element) {
    if (!element || !element.cloneNode) return '';
    const clone = element.cloneNode(true);
    clone.querySelectorAll('script, style, button, svg').forEach((el) => el.remove());
    return clone.textContent?.trim() || '';
  }

  // Shared: assign a stable id to elements that lack a native one (e.g. Claude).
  function assignPfId(el) {
    if (!el) return null;
    if (!el.dataset) return null;
    if (!el.dataset.pfId) el.dataset.pfId = `pf-${Date.now()}-${_idCounter++}`;
    return el.dataset.pfId;
  }

  // ── ChatGPT ──────────────────────────────────────────────────────────────
  // Preserves the original detection behavior exactly: ChatGPT tags each
  // message with data-message-author-role and data-message-id.
  const chatgpt = {
    id: 'chatgpt',
    name: 'ChatGPT',
    hostMatches: ['chatgpt.com', 'chat.openai.com'],
    rootSelector: 'main',
    messageSelector: '[data-message-author-role]',
    inputSelector: '#prompt-textarea, [contenteditable="true"][data-lexical-editor], textarea[data-id]',
    // The Stop button only exists while a response is streaming, so its
    // presence is the most reliable "model is generating" signal.
    stopSelector: 'button[data-testid="stop-button"], button[aria-label*="Stop" i]',
    sendSelector: 'button[data-testid="send-button"], #composer-submit-button, button[aria-label*="Send" i]',
    getRole(el) {
      return el.getAttribute?.('data-message-author-role') || null;
    },
    getMessageId(el) {
      return el.getAttribute?.('data-message-id') || assignPfId(el);
    },
    // Ordered list of signals that mean "ChatGPT is still working". Checked as a
    // group (and logged) so the live DOM reveals the real attribute rather than
    // relying on one guessed selector. A streaming-class check on the latest
    // assistant turn covers builds where the Stop button markup changes.
    generatingSignal() {
      const stop = document.querySelector(this.stopSelector);
      if (stop) return 'stop-button';
      if (document.querySelector('.result-streaming, [data-message-author-role="assistant"] .result-streaming')) {
        return 'result-streaming';
      }
      return null;
    },
    isGenerating() {
      return !!this.generatingSignal();
    },
    // Positive "done" confirmation: the latest assistant turn has text, exposes
    // its action toolbar (copy/regenerate appear only once complete), and no
    // generation signal remains.
    isComplete() {
      if (this.isGenerating()) return false;
      const latest = this.getLatestAssistant();
      if (!latest) return false;
      if (!extractText(latest)) return false;
      const turn = latest.closest('[data-testid^="conversation-turn"]') || latest.parentElement || latest;
      const toolbar = turn && (
        turn.querySelector('[data-testid="copy-turn-action-button"]') ||
        turn.querySelector('button[aria-label*="Copy" i]')
      );
      return !!toolbar;
    },
    getLatestAssistant() {
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
      return msgs[msgs.length - 1] || null;
    },
    getSendButton() {
      return document.querySelector(this.sendSelector) || null;
    },
    extractText,
  };

  // ── Claude ───────────────────────────────────────────────────────────────
  // claude.ai marks user turns with data-testid="user-message" and renders
  // assistant turns inside elements carrying the .font-claude-message class.
  // Claude does not expose a per-message id, so we assign our own.
  const CLAUDE_USER = '[data-testid="user-message"]';
  // Claude's current DOM renders assistant answer text as
  // <p class="font-claude-response-body"> paragraphs (verified). Keep the
  // historical container selectors as fallbacks so an older/newer build that
  // still uses them is handled, but the response-body paragraph is what the
  // live DOM actually exposes.
  const CLAUDE_RESPONSE = 'p.font-claude-response-body';
  const CLAUDE_ASSISTANT = `.font-claude-message, [data-testid="assistant-message"], ${CLAUDE_RESPONSE}`;
  // A finished assistant turn renders an action bar holding assistant-only
  // Copy + Retry buttons; the streaming/thinking turn has none. We count the
  // Retry button (assistant-only, one per completed turn) — verified hooks:
  //   div[data-message-action-bar]
  //   div[role="toolbar"][aria-label="Message actions"]
  //   button[data-testid="action-bar-retry"][aria-label="Retry"]
  const CLAUDE_RETRY = 'button[data-testid="action-bar-retry"]';
  const claude = {
    id: 'claude',
    name: 'Claude',
    hostMatches: ['claude.ai'],
    rootSelector: 'main',
    messageSelector: `${CLAUDE_USER}, ${CLAUDE_ASSISTANT}`,
    inputSelector: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
    stopSelector: 'button[aria-label*="Stop" i]',
    sendSelector: 'button[aria-label*="Send" i]',
    getRole(el) {
      if (el.matches?.(CLAUDE_USER)) return 'user';
      if (el.matches?.(CLAUDE_ASSISTANT)) return 'assistant';
      // Fallbacks: closest container hints
      if (el.closest?.(CLAUDE_USER)) return 'user';
      if (el.closest?.(CLAUDE_ASSISTANT)) return 'assistant';
      return null;
    },
    getMessageId(el) {
      return assignPfId(el);
    },
    getLatestAssistant() {
      // Prefer a stable message container if Claude still renders one.
      const legacy = document.querySelectorAll('.font-claude-message, [data-testid="assistant-message"]');
      if (legacy.length) return legacy[legacy.length - 1];
      // Otherwise fall back to the response-body paragraphs the live DOM uses.
      // Return the shared parent when it holds several paragraphs so the whole
      // multi-paragraph answer is captured, not just the final paragraph.
      const paras = document.querySelectorAll(CLAUDE_RESPONSE);
      const last = paras[paras.length - 1];
      if (!last) return null;
      const parent = last.parentElement;
      if (parent && parent.querySelectorAll &&
          parent.querySelectorAll(CLAUDE_RESPONSE).length > 1) {
        return parent;
      }
      return last;
    },
    // A finished Claude assistant turn renders an action bar with an
    // assistant-only Retry button (button[data-testid="action-bar-retry"]); the
    // in-progress streaming/thinking turn has none. Each user turn produces one
    // assistant answer, so once the Retry-button count reaches the user-turn
    // count, the latest assistant turn has finished. Retry is assistant-only and
    // user turns are counted from a stable per-message hook, so neither side is
    // inflated by multi-paragraph answers. (DOM verified.)
    latestTurnComplete() {
      const userTurns = document.querySelectorAll(CLAUDE_USER).length;
      if (!userTurns) return false;
      return document.querySelectorAll(CLAUDE_RETRY).length >= userTurns;
    },
    // Grouped "still generating" signal (logged in content.js).
    //  1. An active Stop button is authoritative — it covers the window right
    //     after submit, before the new assistant turn renders, so we never
    //     finalize the previous turn early.
    //  2. data-is-streaming="true" can LINGER on a finished message (root cause
    //     of "stuck on Recording, never saves"): trust it only until the turn's
    //     action bar (Retry) has appeared.
    generatingSignal() {
      if (document.querySelector(this.stopSelector)) return 'stop-button';
      if (document.querySelector('[data-is-streaming="true"]') && !this.latestTurnComplete()) return 'is-streaming';
      return null;
    },
    isGenerating() {
      return !!this.generatingSignal();
    },
    // Positive completion signal (mirrors ChatGPT.isComplete): the latest
    // assistant turn has real text and its action bar has rendered.
    isComplete() {
      const latest = this.getLatestAssistant();
      if (!latest || !extractText(latest)) return false;
      return this.latestTurnComplete();
    },
    getSendButton() {
      return document.querySelector(this.sendSelector) || null;
    },
    extractText,
  };

  // ── Gemini ───────────────────────────────────────────────────────────────
  // gemini.google.com renders each turn as an Angular component: <user-query>
  // for the prompt and <model-response> for the answer. Element-name selectors
  // are used first precisely because they are the component contract and survive
  // the class-name churn that Material's generated classes go through; the
  // data-test-id and role fallbacks cover builds that wrap them differently.
  const GEMINI_USER = 'user-query, [data-test-id="user-query"], .user-query-bubble-with-background';
  const GEMINI_ASSISTANT = 'model-response, [data-test-id="model-response"], message-content.model-response-text';
  const gemini = {
    id: 'gemini',
    name: 'Gemini',
    hostMatches: ['gemini.google.com'],
    rootSelector: 'main',
    messageSelector: `${GEMINI_USER}, ${GEMINI_ASSISTANT}`,
    inputSelector: 'rich-textarea .ql-editor, div[contenteditable="true"][role="textbox"], div[contenteditable="true"]',
    stopSelector: 'button[aria-label*="Stop" i], [data-test-id="stop-button"]',
    sendSelector: 'button[aria-label*="Send" i], [data-test-id="send-button"], button.send-button',
    getRole(el) {
      if (el.matches?.(GEMINI_USER) || el.closest?.(GEMINI_USER)) return 'user';
      if (el.matches?.(GEMINI_ASSISTANT) || el.closest?.(GEMINI_ASSISTANT)) return 'assistant';
      return null;
    },
    getMessageId(el) {
      return el.getAttribute?.('id') || assignPfId(el);
    },
    getLatestAssistant() {
      const msgs = document.querySelectorAll(GEMINI_ASSISTANT);
      return msgs[msgs.length - 1] || null;
    },
    generatingSignal() {
      if (document.querySelector(this.stopSelector)) return 'stop-button';
      if (document.querySelector('[data-test-id="loading-indicator"], .response-loading')) return 'loading-indicator';
      return null;
    },
    isGenerating() {
      return !!this.generatingSignal();
    },
    // A finished Gemini turn renders its response action bar (copy / thumbs);
    // while streaming there is none.
    isComplete() {
      if (this.isGenerating()) return false;
      const latest = this.getLatestAssistant();
      if (!latest || !extractText(latest)) return false;
      const turn = latest.closest('model-response') || latest.parentElement || latest;
      return !!(turn && (
        turn.querySelector('message-actions') ||
        turn.querySelector('[data-test-id="copy-button"]') ||
        turn.querySelector('button[aria-label*="Copy" i]')
      ));
    },
    getSendButton() {
      return document.querySelector(this.sendSelector) || null;
    },
    extractText,
  };

  const ADAPTERS = [chatgpt, claude, gemini];

  // Resolve the adapter for a given host (defaults to location.host).
  function getActiveAdapter(host) {
    const h = host || (typeof location !== 'undefined' ? location.host : '');
    return ADAPTERS.find((a) => a.hostMatches.some((m) => h.includes(m))) || null;
  }

  // Pure completion decision (no DOM) — unit-testable. Finalize only when the
  // model is no longer generating and there is real assistant text, confirmed by
  // either a positive "complete" signal (action toolbar) or text that has been
  // stable for at least `settleMs`.
  function isResponseComplete({ generating, hasText, stableMs, settleMs, completeSignal }) {
    if (generating) return false;
    if (!hasText) return false;
    if (completeSignal) return true;
    return stableMs >= settleMs;
  }

  const PFPlatforms = { ADAPTERS, getActiveAdapter, extractText, assignPfId, isResponseComplete };

  if (root) root.PFPlatforms = PFPlatforms;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFPlatforms;
})(typeof self !== 'undefined' ? self : this);
