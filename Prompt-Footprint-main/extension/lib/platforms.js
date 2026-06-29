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
  // Keep the historical class + testid selectors, plus a streaming-content
  // fallback, so a class rename doesn't silently break assistant capture.
  const CLAUDE_ASSISTANT = '.font-claude-message, [data-testid="assistant-message"], [data-is-streaming] .font-claude-message, div[data-is-streaming]';
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
      const msgs = document.querySelectorAll('.font-claude-message, [data-testid="assistant-message"]');
      return msgs[msgs.length - 1] || null;
    },
    isGenerating() {
      // Claude marks the streaming turn with data-is-streaming="true"; the Stop
      // button is the cross-version fallback.
      return !!document.querySelector('[data-is-streaming="true"]') ||
             !!document.querySelector(this.stopSelector);
    },
    getSendButton() {
      return document.querySelector(this.sendSelector) || null;
    },
    extractText,
  };

  const ADAPTERS = [chatgpt, claude];

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
