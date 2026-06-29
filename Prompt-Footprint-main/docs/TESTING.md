# Manual Testing Guide

## Automated tests
```bash
cd extension
npm test        # node:test suite (token estimation, optimizer, storage/savings, platforms)
```

## Load the extension
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the
   repo root (the folder containing `manifest.json`).
2. (Optional) enable verbose logs: open DevTools on a chat tab and run
   `chrome.storage.local.set({ pf_config: { overlayEnabled: true, energyPerTokenMultiplier: 1, debug: true } })`,
   then reload the tab. Logs are prefixed `[PromptFootprint]`.

## Tracking — ChatGPT (chatgpt.com) and Claude (claude.ai)
Repeat on **both** sites:
1. Open a new chat and send a prompt.
2. The floating pill (bottom-left) shows **"Recording…"** with a pulsing dot while the
   model streams (the Stop button is present), then **"Saved"** ~2s after generation stops.
3. Click the pill → the modal shows non-zero session totals and a "Last Query" with tokens
   (prompt **+** response).
4. Open the dashboard (popup → **View Full Stats**, or the extension's options page) →
   **Sessions**: the query appears with non-zero tokens/energy/water/CO₂.
5. **Edge cases:** edit a previous prompt, regenerate a response, and start a brand-new
   conversation. Each real exchange is counted once; navigating between chats does not
   double-count (verify the query count increments by exactly one per send).

## Energy Saver popup
1. In the composer, type a long, padded prompt with a typo, e.g.
   _"Hi there, could you please basically just help me recieve teh seperate files in order to sort them? Thanks in advance!"_
2. The chip appears showing the shorter rewrite, **~N tokens saved (%)**, water/energy, and
   **"3 typos fixed"**.
3. **Drag** the chip by its header to a new spot; reload the page → it reappears in the saved
   position. Confirm it never covers the composer/send button or blocks typing.
4. Click **Apply** → the composer text is replaced with the cleaned prompt.
5. Open dashboard → **Savings** tab: totals (tokens/energy/water/CO₂), **Times Applied**, the
   over-time chart, and the water/energy/CO₂ animations all reflect the Apply. Dismissing a
   suggestion (instead of Applying) records nothing.

## Savings tab
- Replaces the old "Visualize" tab. With no Apply clicks yet it shows a friendly empty state;
  after Apply clicks it shows totals + chart + animations.

## AI optimizer (on by default)
- With a proxy configured (`extension/lib/proxyConfig.js`), the chip badge may switch from
  **Local** to **AI** when a stronger rewrite arrives. The popup carries a disclosure that AI
  rewrites send prompt text to an optimization service (see `docs/PRIVACY.md`).

## Branding
- The optimizer chip uses the PromptFootprint palette (cream surface, earthy-green accents,
  Source Serif / JetBrains Mono) — consistent with the popup, floating pill, and dashboard.
