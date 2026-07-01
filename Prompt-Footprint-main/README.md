# PromptFootprint

A Chrome extension that passively tracks your AI chat usage (**ChatGPT** and
**Claude**, extensible to more) and estimates its environmental impact — energy
(Wh), water (mL), and CO₂ (g) — using a token-level, response-time-aware model.

**Local-first:** all data stays on your device in `chrome.storage.local`. There
is no backend to run and nothing leaves your browser. 🏆 *3rd Place — Climate
ChangeMakers Challenge 2026* · [Devpost](https://devpost.com/software/prompt-footprint)

## Architecture

```
Prompt-Footprint/
├── manifest.json          Chrome extension manifest (MV3)
├── extension/             Chrome extension source (vanilla JS)
│   ├── background.js      Service worker (user id, session lifecycle)
│   ├── content.js         Platform-agnostic DOM observer + overlays + writing UI
│   ├── popup/             Extension popup UI
│   ├── overlay/           Floating + modal overlays, writing-suggestion chip
│   ├── dashboard/         Options page = built stats-site (Settings + Privacy live here)
│   ├── lib/
│   │   ├── platforms.js          Platform adapters (ChatGPT, Claude, …)
│   │   ├── storage.js            Local-first persistence (chrome.storage.local)
│   │   ├── constants.js          Per-platform intensities + response-time model
│   │   ├── tokenEstimator.js     Token estimation
│   │   ├── environmentalModel.js Impact calculation (tokens × time)
│   │   ├── promptOptimizer.js    Local prompt shortener + curated typo map
│   │   ├── spellChecker.js       Offline spell/grammar/punct/cap checker
│   │   ├── writingFormat.js      Diff renderer (bolds changed words, HTML-safe)
│   │   ├── proxyConfig.js        Proxy-first Gemini resolution helpers
│   │   ├── uiHelpers.js          Keybind + viewport-clamp helpers
│   │   ├── vendor/typo.js        Vendored Typo.js (BSD-3-Clause)
│   │   └── dict/                 Compact English Hunspell dictionary (see dict/README.md)
│   ├── test/              Unit tests (node:test)
│   └── styles/            Shared design system CSS
├── stats-site/            React + Vite dashboard; build output is copied to extension/dashboard
└── server/                Legacy Express/Postgres backend (no longer required)
```

## Environmental model

See [`METHODOLOGY.md`](METHODOLOGY.md) for full formulas, constants, sources,
and limitations. In short:

```
impact = totalTokens × perTokenIntensity(platform) × userMultiplier × timeFactor
```

- **ChatGPT (GPT-4o)** intensities are derived from OpenAI's 2025 sustainability
  disclosure (the Vanderbilt YSJ token-level framework). Per 1k tokens: ~1.065 Wh,
  ~3.54 mL, ~0.375 g CO₂.
- **Claude** is scaled from the GPT-4o anchor using independent benchmarks
  (Jegham et al. 2025, arXiv:2505.09598); see methodology for the factor and its
  uncertainty.
- **`timeFactor`** raises the estimate for responses that stream slower than the
  platform baseline (a capped proxy for heavier per-token compute). It is `1` when
  no response time is available, so prior ChatGPT figures are unchanged.

## Setup

### Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the **repo root** directory (where `manifest.json` lives)

No server or configuration is needed — the extension is fully local.

### Usage

1. Navigate to [chatgpt.com](https://chatgpt.com) or [claude.ai](https://claude.ai)
2. Send a message — prompts and responses are auto-detected
3. As you type, the **writing assistant** flags spelling, grammar, capitalization
   and punctuation issues, with the changed words **bolded**. Use **Accept**,
   **Ignore**, or **Accept all safe fixes** (see below)
4. Press <kbd>Alt</kbd>+<kbd>P</kbd> to open/close the main panel; **drag** the
   floating **PF** capsule anywhere (its position is remembered across reloads)
5. Click the extension icon for the popup, or **View Full Stats** for the
   dashboard (which now includes a **Settings & Privacy** page)

### Writing assistant

Two tiers, both optional and safe:

- **Local (offline, always available)** — a real spell checker
  ([Typo.js](extension/lib/vendor/typo.js) + a compact English dictionary, see
  [`extension/lib/dict/README.md`](extension/lib/dict/README.md)) plus a curated
  typo map and lightweight rules for capitalization, punctuation, repeated words,
  and a/an. Nothing leaves your device.
- **AI writing help (optional, Gemini)** — clarity, tone and sentence cleanup.
  **Proxy-first:** your draft is sent to a **Cloudflare Worker** you control,
  which holds the Gemini key. The key is **never** shipped in the extension. If
  no proxy is configured — or it fails or is rate-limited — the editor silently
  uses the offline tier.

### Configuring Gemini (optional)

1. Deploy the Worker in [`proxy/`](proxy/README.md) and set the Gemini key as a
   Cloudflare **secret** (`npx wrangler secret put GEMINI_API_KEY`).
2. Open the extension dashboard → **Settings** and paste your Worker URL.
   (You can also set a default in `extension/lib/proxyConfig.js`.) Advanced users
   may instead enter their own Gemini key, stored only in `chrome.storage.local`
   on their device — the Worker proxy is recommended.

Turn the whole feature off anytime from the popup ("Writing & spell-check
suggestions") or the dashboard Settings page.

### Stats site / dashboard (build → reload)

The dashboard (extension options page) is the built `stats-site`. After changing
`stats-site/`, rebuild it **into** `extension/dashboard`:

```bash
cd stats-site
npm install
npm run dev                                   # http://localhost:5173 (demo data)
npm run build -- --outDir ../extension/dashboard --emptyOutDir
```

Then reload the extension (below). The vanilla `extension/lib/*` and `content.js`
are loaded raw — **no build step** — so only dashboard changes need a rebuild.

### Reloading after changes

`chrome://extensions` → **reload** the unpacked extension (or **Load unpacked** →
the **repo root** directory containing `manifest.json`).

### Tests

```bash
cd extension
npm test         # node:test unit suite
```

## Hosting / deployment

The public site is a **static bundle** deployed free on **GitHub Pages** via
`.github/workflows/pages.yml` (builds `stats-site` and publishes on pushes to
`main`). To enable: repo **Settings → Pages → Build and deployment → Source:
GitHub Actions**. It uses `HashRouter` + a relative Vite base, so it works on a
project subpath with no server rewrites. Because the app is local-first, the
site needs no backend — it serves demo data on the web and reads the user's real
data only when opened as the extension's dashboard.

## Data privacy

- **No prompt or response text is ever stored** — only token counts, timing, and
  computed metrics.
- Each user gets an anonymous UUID generated on first install.
- All tracking data lives **on your device** (`chrome.storage.local`).
- **Spell/grammar checking runs entirely in the browser** (Typo.js + a bundled
  dictionary) — nothing is uploaded.
- **Exception:** the optional **AI writing help** tier sends your in-progress
  draft to the Cloudflare Worker you configured (→ Gemini) to generate a
  suggestion. It is disabled until you set a Worker URL.

### Legal & publishing docs

- [`docs/PRIVACY.md`](docs/PRIVACY.md) — full privacy policy.
- [`docs/TERMS.md`](docs/TERMS.md) — terms of service (first draft).
- [`docs/DATA_DELETION.md`](docs/DATA_DELETION.md) — how to delete local and account data.
- [`docs/SECURITY.md`](docs/SECURITY.md) — security model and how to report issues.
- [`docs/CHROME_STORE_LISTING.md`](docs/CHROME_STORE_LISTING.md) — store listing copy,
  permission justifications, and data-use disclosure answers.
- [`docs/ACCOUNTS.md`](docs/ACCOUNTS.md) — optional login/sync design.
- [`docs/TESTING.md`](docs/TESTING.md) — manual test steps.

## Publishing to the Chrome Web Store

1. Rebuild the dashboard (`stats-site` → `extension/dashboard`, see above) so the
   packaged options page is current.
2. Confirm the manifest permissions and `connect-src` list only what's needed (see
   [`docs/SECURITY.md`](docs/SECURITY.md)); if you enable optional accounts, set the
   real Supabase project origin (no wildcard).
3. Host [`docs/PRIVACY.md`](docs/PRIVACY.md) at a public URL (GitHub Pages works) and
   put that URL in the listing.
4. Fill in the store listing and data-use disclosures from
   [`docs/CHROME_STORE_LISTING.md`](docs/CHROME_STORE_LISTING.md).
5. Zip the repo root (the folder containing `manifest.json`) and upload it.

## Adding a platform

Append an adapter to `ADAPTERS` in `extension/lib/platforms.js` (selectors +
role/text extraction), add a profile to `PLATFORM_PROFILES` in
`extension/lib/constants.js`, and add the host to `manifest.json`
(`host_permissions` + content-script `matches`). No other code changes needed.
