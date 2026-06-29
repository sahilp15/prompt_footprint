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
| Settings (overlay on/off, energy multiplier, optimizer position) | `chrome.storage.local` | **No** |
| Realized savings from clicking "Apply" | `chrome.storage.local` (`pf_savings`) | **No** |

**We do not store the text of your prompts or the model's responses.** Only
counts and derived metrics are persisted. There is no remote backend; the
dashboard reads the same on-device storage.

## The one exception: AI rewrite suggestions

The Energy Saver has two tiers:

1. **Local heuristic** — runs entirely in the browser. Nothing leaves your device.
2. **AI rewrite** — sends the **draft prompt text you are currently typing** to an
   external optimization proxy (a Cloudflare Worker) to produce a stronger
   shorter-prompt suggestion. **This tier is enabled by default.**

What is sent: only the in-progress prompt text, when you pause typing. It is used
solely to generate the suggestion and is not stored by PromptFootprint. This is
the single case where data leaves the device, and it MUST be disclosed in the
Chrome Web Store listing's privacy section.

> If you prefer that no prompt text ever leaves your device, this tier can be
> disabled (the local heuristic remains fully functional). See the popup
> disclosure note.

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
