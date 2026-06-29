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
    inputSelector: '#prompt-textarea',
    getRole(el) {
      return el.getAttribute?.('data-message-author-role') || null;
    },
    getMessageId(el) {
      return el.getAttribute?.('data-message-id') || assignPfId(el);
    },
    getLatestAssistant() {
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
      return msgs[msgs.length - 1] || null;
    },
    extractText,
  };

  // ── Claude ───────────────────────────────────────────────────────────────
  // claude.ai marks user turns with data-testid="user-message" and renders
  // assistant turns inside elements carrying the .font-claude-message class.
  // Claude does not expose a per-message id, so we assign our own.
  const claude = {
    id: 'claude',
    name: 'Claude',
    hostMatches: ['claude.ai'],
    rootSelector: 'main',
    messageSelector: '[data-testid="user-message"], .font-claude-message',
    inputSelector: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
    getRole(el) {
      if (el.matches?.('[data-testid="user-message"]')) return 'user';
      if (el.matches?.('.font-claude-message')) return 'assistant';
      // Fallbacks: closest container hints
      if (el.closest?.('[data-testid="user-message"]')) return 'user';
      if (el.closest?.('.font-claude-message')) return 'assistant';
      return null;
    },
    getMessageId(el) {
      return assignPfId(el);
    },
    getLatestAssistant() {
      const msgs = document.querySelectorAll('.font-claude-message');
      return msgs[msgs.length - 1] || null;
    },
    extractText,
  };

  const ADAPTERS = [chatgpt, claude];

  // Resolve the adapter for a given host (defaults to location.host).
  function getActiveAdapter(host) {
    const h = host || (typeof location !== 'undefined' ? location.host : '');
    return ADAPTERS.find((a) => a.hostMatches.some((m) => h.includes(m))) || null;
  }

  const PFPlatforms = { ADAPTERS, getActiveAdapter, extractText, assignPfId };

  if (root) root.PFPlatforms = PFPlatforms;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFPlatforms;
})(typeof self !== 'undefined' ? self : this);
