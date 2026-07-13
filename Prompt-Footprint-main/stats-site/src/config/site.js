// Central site configuration.
//
// Everything a public visitor might click — the production domain, the Chrome
// Web Store link, and contact emails — lives here so it can be updated in ONE
// place before launch. Values fall back to sensible defaults but can be
// overridden at build time with Vite env vars (VITE_*) if you'd rather keep
// them out of source. See stats-site/.env.example.
//
// ─────────────────────────────────────────────────────────────────────────
//  TODO BEFORE PUBLIC LAUNCH — replace / activate the PLACEHOLDER values:
//   1. SUPPORT_EMAIL      — inbox not created yet. Set up mail routing for the
//                           domain, then confirm this address delivers.
//   2. LEGAL_EMAIL        — same: create the alias before relying on it.
//  None of these are secrets. Do NOT put private keys or personal email here.
// ─────────────────────────────────────────────────────────────────────────

const env = import.meta.env

export const SITE = {
  name: 'PromptFootprint',
  tagline: 'See the energy, water, and CO₂ behind every AI prompt.',

  // Production domain (already registered).
  url: env.VITE_SITE_URL || 'https://promptfootprint.app',

  // Live extension link
  chromeStoreUrl: env.VITE_CHROME_STORE_URL || 'https://chromewebstore.google.com/detail/promptfootprint/mlnchdecieopfkpijgoecfglbpdmemdp',

  // PLACEHOLDER emails — aliases on promptfootprint.app that still need to be
  // created and routed to a real inbox. Never a personal address.
  supportEmail: env.VITE_SUPPORT_EMAIL || 'support@promptfootprint.app',
  legalEmail: env.VITE_LEGAL_EMAIL || 'legal@promptfootprint.app',
  securityEmail: env.VITE_SECURITY_EMAIL || 'security@promptfootprint.app',

  // Public source / issue tracker.
  githubUrl: 'https://github.com/sahilp15/prompt_footprint',
  issuesUrl: 'https://github.com/sahilp15/prompt_footprint/issues',

  // Supported chat platforms, referenced in copy.
  platforms: ['ChatGPT', 'Claude'],
}

// True once a real Chrome Web Store listing URL has been set.
export const hasChromeStoreLink = () => Boolean(SITE.chromeStoreUrl)

// Live-demo dashboard URL. The dashboard lives at the `#/app` hash route in the
// public web build; this resolves it relative to wherever the site is hosted so
// it works on promptfootprint.app, a GitHub Pages subpath, or localhost alike.
export const demoUrl = () => {
  if (typeof window === 'undefined') return '#/app'
  return `${window.location.href.split('#')[0]}#/app`
}
