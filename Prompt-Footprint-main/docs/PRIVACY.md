# PromptFootprint — Privacy Policy

_Last updated: 2026-07-01_

PromptFootprint is a browser extension that estimates the environmental impact
(tokens → energy, water, CO₂) of your AI chat usage on ChatGPT and Claude, offers
a local spell/grammar checker and an optional AI writing helper, and suggests
shorter prompts that use fewer tokens.

This policy explains exactly what the extension does with data. The short version:
**everything works on your device by default, and your prompts and the models'
replies are never stored or uploaded.** A couple of features can send data off the
device — but only ones you turn on yourself, and this policy spells out each one.

> This is a plain-language policy written by the project, not formal legal advice.

---

## 1. What PromptFootprint does

- Watches your messages on ChatGPT (`chatgpt.com`, `chat.openai.com`) and Claude
  (`claude.ai`), counts tokens from text length, and estimates the energy, water,
  and CO₂ behind them.
- Shows a small draggable overlay with your running totals, and a full dashboard
  with weekly stats.
- Runs an offline spelling/grammar/clarity checker as you type.
- Optionally rewrites your draft with Google Gemini, if you enable it.
- Suggests shorter prompts and totals up the tokens you save when you apply them.

## 2. What is stored, and where

By default there is **no server**. Data lives in your browser's `chrome.storage.local`,
which is private to the extension in your Chrome profile.

| Data | Stored where | Leaves your device? |
|------|--------------|---------------------|
| Token counts, timing, estimated energy/water/CO₂ per session | `chrome.storage.local` | **No** |
| Anonymous install ID (random UUID) | `chrome.storage.local` | **No** |
| Settings (overlay/writing toggles, energy multiplier, capsule/optimizer position, Worker URL, optional Gemini key) | `chrome.storage.local` | **No** |
| Realized savings from applying shorter-prompt suggestions | `chrome.storage.local` (`pf_savings`) | **No** |
| **The text of your prompts and the models' replies** | **Not stored** | **No** |

**We never store the text of your prompts or the models' responses.** The extension
reads that text in the page only to count its length and to run local spell-checks;
it is not written to storage and not sent anywhere (except the one optional case in
§4).

## 3. Spell & grammar checking is fully offline

The baseline writing checker — misspellings, capitalization, punctuation, repeated
words, a/an — runs **entirely in your browser** using a bundled dictionary
(Typo.js + `extension/lib/dict/`). No text is uploaded for these checks.

## 4. Optional AI writing help (off by default)

The writing helper has two tiers:

1. **Local checker** — runs in the browser. Nothing leaves your device.
2. **AI writing help (Gemini)** — sends the **draft text you are currently typing**
   to an external service to produce higher-quality suggestions (clarity, tone,
   sentence cleanup).

This second tier is **proxy-first and disabled by default.** It does nothing until
you set a Cloudflare Worker URL (which holds the Gemini API key) on the dashboard
Settings page. The Gemini key is **never** shipped in the extension.

What is sent, only when you enable this tier: the in-progress draft text, when you
pause typing. It is used solely to generate the suggestion and is **not stored** by
PromptFootprint or (in the recommended setup) by the Worker. If the Worker is unset,
fails, or is rate-limited, the editor silently falls back to the offline checker.

To keep everything on-device, leave the Worker URL blank. The offline checker still
works. You can also turn off all suggestions from the popup or Settings.

> Advanced users may instead store their own Gemini key locally in
> `chrome.storage.local`. That key is used directly from your browser, stays on your
> device, and is **never synced to any account** (see §5). The Worker proxy is
> recommended over this.

## 5. Optional accounts and cloud sync (off by default)

PromptFootprint works fully without an account. If you choose to create one (email
and password), you can sync some data across your devices. This is entirely
optional; signed-out use is unchanged.

**What syncs when you are signed in:**

- Non-sensitive settings: overlay on/off, writing checks on/off, and the energy
  multiplier.
- Per-session **summaries**: token counts, timing, and the estimated energy/water/CO₂
  totals for each session — **numbers only, no prompt or reply text**.
- Realized savings, as a **per-day total** (tokens/energy/water/CO₂ saved).

**What never syncs, even when signed in:**

- The text of your prompts or the models' replies (it is never stored in the first
  place).
- Your Gemini API key or Worker URL.
- Per-message detail and on-screen positions of the overlay.

Accounts and sync are provided using **Supabase** (authentication and a Postgres
database). Your synced rows are protected by row-level security so that only your
account can read them. Signing out keeps all of your local data and returns the
extension to on-device-only mode. If you are offline or the service is unavailable,
local tracking keeps working and syncs later.

## 6. Analytics and diagnostics

There are **no analytics or telemetry SDKs** (no Google Analytics, Mixpanel,
Sentry, or similar). The extension does not phone home. An optional "Debug logging"
toggle prints tracking events to your own browser console for troubleshooting; that
output stays in your browser and is off by default.

## 7. How to delete your data

- **Local data:** open the popup → Settings, or uninstall the extension — removing
  it deletes all on-device data. You can also clear it from
  `chrome://extensions` → Details → Site data / storage.
- **Account data (if you created an account):** use the "Delete account" option on
  the dashboard Account page, or email us (§9). Deleting your account removes your
  synced settings, session summaries, and savings from the server.

Full steps are in [DATA_DELETION.md](./DATA_DELETION.md).

## 8. Permissions and why each is needed

- `storage` — save your metrics, settings, and savings locally.
- `activeTab` — let the toolbar popup toggle the overlay on the ChatGPT/Claude tab
  you are looking at.
- `alarms` (if enabled) — schedule an occasional background sync for signed-in users.
- Host access:
  - `https://chatgpt.com/*`, `https://chat.openai.com/*`, `https://claude.ai/*` —
    inject the tracking + writing script on the supported chat sites.
  - `https://*.workers.dev/*` — reach the optional Gemini writing proxy you configure.
  - `https://<your-project>.supabase.co/*` — reach the account/sync backend (only
    used if you sign in).

No `tabs`, `<all_urls>`, `webRequest`, `cookies`, or remote-code permissions are
requested. The extension contains no remotely loaded or `eval`'d code.

## 9. Contact and support

- Issues and questions: <https://github.com/sahilp15/prompt_footprint/issues>
- Email (placeholder — replace before publishing): `support@promptfootprint.app`

## 10. Changes to this policy

We'll update the "Last updated" date above when this policy changes and note
material changes in the extension's release notes.
