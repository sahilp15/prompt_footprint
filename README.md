# PromptFootprint

A Chrome extension that passively tracks your AI chat usage (**ChatGPT** and
**Claude**, extensible to more) and estimates its environmental impact — energy
(Wh), water (mL), and CO₂ (g) — using a token-level, response-time-aware model.

**Local-first:** by default all data stays on your device in
`chrome.storage.local` and nothing leaves your browser. No backend is required to
run it. Optional accounts (Supabase) can sync your settings and stats *summaries*
across devices — never your prompt text and never your Gemini key; see
[`docs/ACCOUNTS.md`](docs/ACCOUNTS.md).

🏆 **3rd Place** — The Climate Change-Makers Challenge 2026 (nearly 300
participants, 40+ countries) ·
[Devpost](https://devpost.com/software/prompt-footprint)
🏆 **4th Place** — Hoobit Hacks 2026 (570+ participants, international) ·
[Devpost](https://devpost.com/software/promptfootprint)

## Architecture

```
Prompt-Footprint/
├── manifest.json          Chrome extension manifest (MV3)
├── extension/             Chrome extension source (vanilla JS)
│   ├── background.js      Service worker (user id, session lifecycle)
│   ├── content.js         Platform-agnostic DOM observer + overlays + assistant wiring
│   ├── popup/             Extension popup UI
│   ├── overlay/           Floating + modal overlays, in-page assistant (UI + shadow-DOM CSS)
│   ├── dashboard/         Options page = built stats-site (Settings + Privacy live here)
│   ├── lib/
│   │   ├── platforms.js          Platform adapters (ChatGPT, Claude, …)
│   │   ├── storage.js            Local-first persistence (chrome.storage.local)
│   │   ├── constants.js          Per-platform intensities + response-time model
│   │   ├── tokenEstimator.js     Token estimation
│   │   ├── environmentalModel.js Impact calculation (tokens × time)
│   │   ├── tokenCutter.bundle.js Token Cutter engine, built from stats-site (npm run build:cutter)
│   │   ├── composer.js           Evidence-based composer detection + safe read/write
│   │   ├── assistantState.js     Assistant states, debounce, stale-request guard, settings
│   │   ├── promptOptimizer.js    Local prompt shortener + curated typo map
│   │   ├── spellChecker.js       Offline spell/grammar/punct/cap checker (unused in-page; see below)
│   │   ├── writingFormat.js      Diff renderer (bolds changed words, HTML-safe)
│   │   ├── proxyConfig.js        Proxy-first Gemini resolution helpers
│   │   ├── uiHelpers.js          Keybind + viewport-clamp helpers
│   │   ├── vendor/typo.js        Vendored Typo.js (BSD-3-Clause)
│   │   └── dict/                 Compact English Hunspell dictionary (see dict/README.md)
│   ├── test/              Unit tests (node:test)
│   └── styles/            Shared design system CSS
├── stats-site/            React + Vite dashboard; build output is copied to extension/dashboard
│   ├── src/lib/tokenCutter/   Token Cutter engine (local-first prompt optimizer)
│   ├── src/components/cutter/ Token Cutter UI
│   └── test/                  node:test suite for the engine
├── supabase/              Optional accounts/sync: schema + RLS migration, config, RLS test
└── server/                Legacy Express/Postgres backend (dormant; not used)
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
3. As you type, the **in-page assistant** appears beside the composer with your
   live token count and, when there is a real saving to be had, how much a
   shorter version would avoid. Click it to compare the two prompts, then
   **Replace prompt** — or **Undo** (see below)
4. Press <kbd>Alt</kbd>+<kbd>P</kbd> to open/close the main panel; **drag** the
   floating **PF** capsule anywhere (its position is remembered across reloads)
5. Click the extension icon for the popup, or **View Full Stats** for the
   dashboard (which now includes a **Settings & Privacy** page)

### Token Cutter

A full prompt optimizer lives in the dashboard at **Token Cutter**. Paste a
prompt and it shows what can be removed and why, with per-suggestion accept and
reject controls, a side-by-side comparison, and the tokens, energy, water, and
CO₂ you avoid by sending the shorter version.

It runs **entirely on your device** — no API key, no account, no network. It
protects code, JSON, links, quotes, placeholders, numbers, dates, and names;
detects repeated instructions and restated constraints; and re-checks the result
against your original before offering it, reporting anything that went missing.

Three levels (Light / Balanced / Maximum), transparent local memory for
preferences you shouldn't have to restate, and an optional Gemini pass that
falls back to the local result whenever it is unavailable or produces something
that fails the same local validation.

See [`docs/TOKEN_CUTTER.md`](docs/TOKEN_CUTTER.md) for the
full design.

### In-page assistant

The same Token Cutter, in the composer. `extension/lib/tokenCutter.bundle.js` is
built from `stats-site/src/lib/tokenCutter/` (`npm run build:cutter`), so the
dashboard and the in-page assistant run **one engine** — the same suggestions,
the same figures, the same validation.

- **Collapsed** — a small indicator anchored above the composer: token count,
  tokens saved, percent reduction, a quiet water estimate, and **Optimize**. It
  sits outside the composer surface, so it never covers the text box, the
  attachment row, the dictation button, or send.
- **Expanded** — both prompts side by side with token counts, what changed and
  why, and the preservation report. **Replace prompt**, **Copy optimized**,
  **Try again** (next compression level), **Keep original**, **Undo**.
- **Analysis is debounced** to a pause in typing, and a result whose prompt has
  since changed is discarded rather than shown.
- **Nothing is ever rewritten without a click**, and **Undo** restores your
  original text exactly.
- Short or already-tight prompts report **"Already concise"** rather than being
  changed for the sake of it.

Composer detection is evidence-based rather than selector-based — editability,
role, placeholder wording, a nearby send control, geometry, and the platform
adapter's own selector are scored together, so no single ChatGPT or Claude
redesign can break it. The UI lives in a shadow root, so page CSS cannot reach
it and it cannot leak onto the page.

Settings live in the extension popup and in the panel's own gear menu: on/off,
default compression level, analyze-while-typing, environmental estimates,
animations, local vs enhanced mode, and reset. All of them are keys in the
existing `pf_config`.

**Enhanced (Gemini) mode is optional and doubly gated** — you must both enable
cloud analysis and select enhanced mode, or nothing leaves the device. When it
is on, the remote rewrite must return every protected span byte-identical and
pass the *same local validator* as a local suggestion; otherwise the local result
is kept and the panel says why. **Proxy-first:** the draft goes to a
**Cloudflare Worker** you control, which holds the Gemini key. The key is
**never** shipped in the extension.

> The dictionary-backed spell checker that the old suggestion chip used
> (`lib/spellChecker.js`, `lib/vendor/typo.js`, `lib/dict/`) is **no longer
> loaded in the page**. The Token Cutter's own grammar detector covers
> misspellings, apostrophes, doubled words, a/an, and spacing with a curated map
> — a deliberate choice documented in `docs/TOKEN_CUTTER.md` ("a confidently
> wrong correction of a name or an API is worse than an uncorrected typo"). The
> files and their tests remain in the repo.

### Configuring Gemini (optional)

1. Deploy the Worker in [`proxy/`](proxy/README.md) and set the Gemini key as a
   Cloudflare **secret** (`npx wrangler secret put GEMINI_API_KEY`).
2. Open the extension dashboard → **Settings** and paste your Worker URL.
   (You can also set a default in `extension/lib/proxyConfig.js`.) Advanced users
   may instead enter their own Gemini key, stored only in `chrome.storage.local`
   on their device — the Worker proxy is recommended.

Turn the whole feature off anytime from the popup ("In-page prompt assistant")
or the panel's gear menu.

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

### Token Cutter engine bundle (build → reload)

The in-page assistant runs the Token Cutter as a content-script global. After
changing anything under `stats-site/src/lib/tokenCutter/`, rebuild the bundle:

```bash
cd extension
npm install          # esbuild
npm run build:cutter # -> extension/lib/tokenCutter.bundle.js
```

The output is committed, the same way `extension/dashboard/` and
`extension/lib/vendor/supabase.js` are.

### Reloading after changes

`chrome://extensions` → **reload** the unpacked extension (or **Load unpacked** →
the **repo root** directory containing `manifest.json`).

### Tests

```bash
cd extension
npm test         # node:test unit suite (extension libs)
                 # DOM-backed cases (composer detection, prompt replacement,
                 # undo, duplicate mounting) need jsdom — they skip themselves
                 # until you `npm install`, and run after it.

# In-page assistant, end to end in a real Chromium with the extension loaded,
# against pages shaped like ChatGPT and Claude. Not part of `npm test`.
npm install --no-save playwright && npx playwright install chromium
npm run test:e2e                 # add --shots ./shots to capture screenshots

cd ../stats-site
npm run check    # typecheck + lint + tests + production build
npm run eval     # Token Cutter quality metrics
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
- [`docs/BACKEND_DEPLOYMENT.md`](docs/BACKEND_DEPLOYMENT.md) — provision Supabase and wire keys.
- [`docs/TESTING.md`](docs/TESTING.md) — manual test steps.


## Adding a platform

Append an adapter to `ADAPTERS` in `extension/lib/platforms.js` (selectors +
role/text extraction), add a profile to `PLATFORM_PROFILES` in
`extension/lib/constants.js`, and add the host to `manifest.json`
(`host_permissions` + content-script `matches`). No other code changes needed.
