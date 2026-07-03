# Chrome Web Store — Listing & Data Disclosure Draft

_Last updated: 2026-07-01. Draft copy to paste into the Chrome Web Store developer
dashboard. Replace placeholder URLs/emails before submitting._

## Single purpose

PromptFootprint estimates the environmental impact (energy, water, CO₂) of your AI
chats on ChatGPT and Claude and helps you write shorter, cleaner prompts.

## Short description (≤132 chars)

See the energy, water, and CO₂ behind your ChatGPT and Claude prompts — and write
tighter prompts. Local-first and private.

## Detailed description

PromptFootprint adds a small overlay to ChatGPT and Claude that estimates the
energy, water, and CO₂ behind each conversation, based on how many tokens you send
and receive. A full dashboard shows your weekly totals and the savings you earn by
trimming prompts.

It's local-first: the estimates are calculated in your browser and stored on your
device. Your prompts and the models' replies are never saved or uploaded.

What you get:
- Live energy/water/CO₂ estimates for ChatGPT and Claude, with a clear explanation
  of what's measured versus estimated.
- An offline spelling, grammar, and clarity checker as you type.
- Optional AI writing help (Google Gemini) that you turn on yourself and route
  through your own secure proxy.
- A prompt "Energy Saver" that suggests shorter wording and totals the tokens you
  save.
- Optional accounts to sync your settings and stats across devices — never your
  prompt text.

Open the dashboard's "How it works" page for the exact method, sources, and
limitations. PromptFootprint gives estimates to build intuition, not audited
measurements.

## Privacy policy URL

`https://<host-the-policy-here>/PRIVACY` — host `docs/PRIVACY.md` publicly (for
example on the project's GitHub Pages site) and paste the URL here.

## Permission justifications (per-permission fields)

- **storage** — Save your impact metrics, settings, and savings on your own device.
- **activeTab** — Let the toolbar popup toggle the overlay on the ChatGPT/Claude tab
  you're viewing.
- **alarms** (if included) — Schedule an occasional background sync for signed-in
  users. Omit this justification if the alarm-based sync is not shipped.
- **Host `https://chatgpt.com/*`, `https://chat.openai.com/*`, `https://claude.ai/*`** —
  Run the tracking and writing-assistant script on the supported chat sites.
- **Host `https://*.workers.dev/*`** — Send draft text to the optional Gemini writing
  proxy that the user configures.
- **Host `https://<project>.supabase.co/*`** — Reach the optional account/sync
  backend, used only when the user signs in.
- **Host `https://api.open-meteo.com/*`, `https://geocoding-api.open-meteo.com/*`** —
  Look up weather (and geocode a city/ZIP) for the optional heatwave estimate, only
  when the user opts in to a location. No API key.

## Data-use disclosures (Chrome Web Store "Privacy practices" form)

Declare the following data types as **collected**:

- **Personally identifiable information (email address)** — only if the user creates
  an optional account. Used for authentication. Not sold; not used for advertising.
- **Website content (user-typed text)** — the draft you are typing is sent to a
  third-party AI service **only if** you turn on cloud analysis. It is used to
  generate the suggestion and is not stored by PromptFootprint. Prompt/reply text is
  otherwise never collected.
- **Location (approximate)** — only if the user opts in to the heatwave estimate. A
  **coarsened** coordinate (rounded to ~11 km, never precise) or a city/ZIP the user
  types is sent to Open-Meteo to fetch nearby weather. Used only for that estimate,
  stored locally, not sold, not used for advertising.

Do **not** declare (because they don't apply): financial info, health info,
authentication info beyond the account email/password handled by Supabase, personal
communications content storage, web history, or user activity analytics.

Certification checkboxes to confirm:
- [x] I do not sell or transfer user data to third parties outside of the approved
      use cases.
- [x] I do not use or transfer user data for purposes unrelated to the item's single
      purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for
      lending.

## Pre-submission checklist

- [ ] Host the privacy policy at a public URL and paste it into the listing.
- [ ] Complete the data-use disclosures above.
- [ ] Confirm the manifest `connect-src`/`host_permissions` list only the real
      Supabase project origin (no wildcard) before packing.
- [ ] Confirm no analytics/telemetry SDKs are bundled (there are none).
- [ ] Confirm no remote/`eval`'d code (MV3 CSP already forbids it).
- [ ] Rebuild the dashboard and pack the extension from the repo root.
