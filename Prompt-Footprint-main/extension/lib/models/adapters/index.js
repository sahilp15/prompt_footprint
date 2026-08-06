// PromptFootprint Provider Adapter Registry
// ---------------------------------------------------------------------------
// One place that answers "which adapter owns this page?". Hostname decides, so a
// page can never be handled by two adapters, and an unsupported host resolves to
// null rather than to a default provider.

(function (root) {
  'use strict';

  const openai = (typeof PFAdapterOpenAI !== 'undefined') ? PFAdapterOpenAI : require('./openai.js');
  const anthropic = (typeof PFAdapterAnthropic !== 'undefined') ? PFAdapterAnthropic : require('./anthropic.js');
  const google = (typeof PFAdapterGoogle !== 'undefined') ? PFAdapterGoogle : require('./google.js');

  const ADAPTERS = [openai, anthropic, google];

  /** Accepts a URL, a Location, or a bare host string. */
  function forLocation(urlLike) {
    if (!urlLike) return null;
    let host = '';
    if (typeof urlLike === 'string') {
      try { host = new URL(urlLike).host; } catch (_) { host = urlLike; }
    } else {
      host = urlLike.host || urlLike.hostname || '';
    }
    return ADAPTERS.find((a) => a.matchesLocation({ host })) || null;
  }

  function byProvider(provider) {
    return ADAPTERS.find((a) => a.provider === provider) || null;
  }

  const PFProviderAdapters = { ADAPTERS, forLocation, byProvider };

  if (root) root.PFProviderAdapters = PFProviderAdapters;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFProviderAdapters;
})(typeof self !== 'undefined' ? self : this);
