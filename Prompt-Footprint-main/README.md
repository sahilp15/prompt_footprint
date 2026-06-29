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
│   ├── content.js         Platform-agnostic DOM observer + overlays + optimizer UI
│   ├── popup/             Extension popup UI
│   ├── overlay/           Floating + modal overlays, prompt-optimizer chip
│   ├── dashboard/         Options page (session history, local data)
│   ├── lib/
│   │   ├── platforms.js          Platform adapters (ChatGPT, Claude, …)
│   │   ├── storage.js            Local-first persistence (chrome.storage.local)
│   │   ├── constants.js          Per-platform intensities + response-time model
│   │   ├── tokenEstimator.js     Token estimation
│   │   ├── environmentalModel.js Impact calculation (tokens × time)
│   │   └── promptOptimizer.js    Local prompt shortener
│   ├── test/              Unit tests (node:test)
│   └── styles/            Shared design system CSS
├── stats-site/            React + Vite showcase/dashboard (demo data on the web)
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
3. Type a long prompt to get a **shorter-prompt suggestion** with estimated savings
   before you send
4. Click the floating **PF** pill (bottom-left) for per-query metrics
5. Click the extension icon for the popup, or **View Full Stats** for the dashboard

### Stats site (optional, for the public showcase)

```bash
cd stats-site
npm install
npm run dev      # http://localhost:5173 (shows demo data)
npm run build    # static bundle in dist/
```

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
- All data lives **on your device**; nothing is transmitted to any server.

## Adding a platform

Append an adapter to `ADAPTERS` in `extension/lib/platforms.js` (selectors +
role/text extraction), add a profile to `PLATFORM_PROFILES` in
`extension/lib/constants.js`, and add the host to `manifest.json`
(`host_permissions` + content-script `matches`). No other code changes needed.
