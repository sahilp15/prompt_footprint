// PromptFootprint AI optimizer endpoint.
// ---------------------------------------------------------------------------
// PROXY-FIRST design. The Gemini API key is NEVER shipped in the extension
// (users can read extension source). It lives only as a Cloudflare Worker
// secret. The extension calls the Worker's PUBLIC URL; the Worker calls Gemini.
//
//   extension  →  Cloudflare Worker (holds GEMINI_API_KEY)  →  Gemini API
//
// PF_PROXY_URL below is the built-in default Worker URL (NOT a secret). Users
// can also override it (or, for advanced use, supply their own Gemini key) from
// settings; those live in chrome.storage.local (pf_config), never in source.
//
// No proxy URL and no key  ⇒  local-only mode (offline typo.js + rule checks).
// Worker failure / rate limit  ⇒  graceful fallback to local-only.
(function (root) {
  'use strict';

  const PF_PROXY_URL = ''; // e.g. 'https://promptfootprint-proxy.yourname.workers.dev'

  function isHttpUrl(s) {
    return typeof s === 'string' && /^https:\/\/[^\s]+$/i.test(s.trim());
  }

  // Effective Worker URL: a valid user override wins, else the built-in default.
  function resolveProxyUrl(config) {
    const override = config && config.proxyUrl;
    if (isHttpUrl(override)) return override.trim();
    return PF_PROXY_URL;
  }

  // Which writing-improvement provider is available given the current config.
  // 'gemini' when a proxy URL (or advanced user key) is configured, else
  // 'local'. Pure — used by background.js and unit tests.
  function resolveWritingProvider(config) {
    if (resolveProxyUrl(config)) return 'gemini';
    if (config && typeof config.geminiApiKey === 'string' && config.geminiApiKey.trim()) return 'gemini';
    return 'local';
  }

  // Safely pull a string field from a parsed proxy/Gemini response. Returns ''
  // for null, non-objects, missing keys, or non-string values, so malformed or
  // rate-limited responses degrade to local-only instead of breaking the UI.
  function pickField(data, key) {
    if (!data || typeof data !== 'object') return '';
    const v = data[key];
    return typeof v === 'string' ? v.trim() : '';
  }

  const api = { PF_PROXY_URL, isHttpUrl, resolveProxyUrl, resolveWritingProvider, pickField };
  if (root) {
    root.PF_PROXY_URL = PF_PROXY_URL;
    root.PFProxyConfig = api;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
