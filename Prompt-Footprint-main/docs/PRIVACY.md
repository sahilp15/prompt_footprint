# PromptFootprint — Privacy Policy & Chrome Web Store Readiness

_Last updated: 2026-06-29_

PromptFootprint is a browser extension that estimates the environmental impact
(tokens → energy, water, CO₂) of your AI chat usage on ChatGPT and Claude, and
offers an optional "Energy Saver" that suggests shorter prompts.

## What data we collect and where it lives

| Data | Stored where | Leaves your device? |
|------|--------------|---------------------|
| Token counts, timing, computed energy/water/CO₂ metrics | `chrome.storage.local` (on-device) | **No** |
| Anonymous install ID (random UUID) | `chrome.storage.local` | **No** |
| Settings (overlay/writing toggles, energy multiplier, capsule/optimizer position, Worker URL, optional Gemini key) | `chrome.storage.local` | **No** |
| Realized savings from clicking "Apply"/"Accept" | `chrome.storage.local` (`pf_savings`) | **No** |

**We do not store the text of your prompts or the model's responses.** Only
counts and derived metrics are persisted. There is no remote backend; the
dashboard reads the same on-device storage.

## Spell & grammar checking is fully offline

The writing assistant's baseline tier — misspellings, capitalization,
punctuation, repeated words, a/an — runs **entirely in your browser** using a
bundled dictionary ([Typo.js](../extension/lib/vendor/typo.js) +
`extension/lib/dict/`). No text is uploaded for local checks.

## The one exception: AI writing help (optional, off by default)

The writing assistant has two tiers:

1. **Local checker** — runs entirely in the browser. Nothing leaves your device.
2. **AI writing help (Gemini)** — sends the **draft text you are currently
   typing** to an external proxy to produce higher-quality suggestions (clarity,
   tone, sentence cleanup). **Proxy-first and disabled by default:** it does
   nothing until you set a Cloudflare Worker URL (which holds the Gemini key) in
   the dashboard Settings page. The Gemini key is **never** shipped in the
   extension. (Advanced users may instead store their own Gemini key locally in
   `chrome.storage.local`; the proxy is recommended.)

What is sent, only when this tier is enabled: the in-progress draft text, when
you pause typing. It is used solely to generate the suggestion and is not stored
by PromptFootprint. If the proxy is unset, fails, or is rate-limited, the editor
silently falls back to the offline checker. This is the single case where data
leaves the device, and it MUST be disclosed in the Chrome Web Store listing.

> To keep everything on-device, leave the Worker URL blank (and set no Gemini
> key). The offline checker remains fully functional. You can also turn off all
> suggestions via the popup or dashboard Settings.

## Permissions justification (permission minimization)

- `storage` — persist metrics, settings, and savings locally.
- `activeTab` — let the toolbar popup message the active ChatGPT/Claude tab to
  toggle the overlay.
- Host permissions:
  - `https://chatgpt.com/*`, `https://chat.openai.com/*`, `https://claude.ai/*` —
    inject the tracking content script on supported chat sites.
  - `https://*.workers.dev/*` — the AI-rewrite optimization proxy.

  The previous `https://prod.spline.design/*` host permission was **removed**: the
  packaged dashboard no longer loads Spline 3D assets, so it is no longer needed.

No `tabs`, `<all_urls>`, `webRequest`, `cookies`, or remote-code permissions are
requested.

## Before publishing — checklist

- [ ] Host this privacy policy at a public URL and add it to the store listing.
- [ ] Complete the Chrome Web Store **data-use disclosures**: declare that prompt
      text is transmitted to a third-party service for the AI-rewrite feature;
      everything else is on-device.
- [ ] Write a **single-purpose** description (environmental-impact tracking for AI
      chats + prompt optimization).
- [x] Add in-product consent/disclosure copy for the AI tier (popup note added).
- [x] Remove the `prod.spline.design` host permission (packaged dashboard no
      longer uses Spline).
- [ ] Confirm no analytics/telemetry SDKs are bundled (there are none today).
- [ ] Verify the extension does not contain remote/eval'd code (MV3 CSP already
      forbids it).
