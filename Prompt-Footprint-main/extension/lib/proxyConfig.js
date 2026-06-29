// PromptFootprint AI optimizer endpoint.
// ---------------------------------------------------------------------------
// This is the PUBLIC URL of your deployed Cloudflare Worker (see proxy/README.md).
// It is NOT a secret — the Gemini API key lives only inside the Worker, never
// here and never in the downloaded extension.
//
// Paste your Worker URL below to enable AI prompt rewriting. Leave it empty to
// disable AI and use only the local heuristic optimizer (fully offline).
(function (root) {
  'use strict';
  const PF_PROXY_URL = ''; // e.g. 'https://promptfootprint-proxy.yourname.workers.dev'
  if (root) root.PF_PROXY_URL = PF_PROXY_URL;
  if (typeof module !== 'undefined' && module.exports) module.exports = { PF_PROXY_URL };
})(typeof self !== 'undefined' ? self : this);
