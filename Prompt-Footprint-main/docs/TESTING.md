# Manual Testing Guide

## Automated tests
```bash
cd extension
npm test        # node:test suite (token estimation, optimizer, storage/savings,
                # platforms, plus Phase-2 sync payload/merge/auth-state/auth-service)
```

The Phase-2 account/sync logic is unit-tested without a database via pure
modules: `syncPayload` (proves raw text + the Gemini key are never in the upload
payload), `syncMerge` (proves sync is idempotent and savings can't double-count),
`authState` (logged-out/in/offline + local-only fallback), and `authService`
(login/logout/status/delete with a stubbed Supabase). Row-Level Security itself
needs a real Postgres and is tested separately with `supabase test db`
(`supabase/tests/rls.test.sql`).

## Load the extension
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the
   repo root (the folder containing `manifest.json`).
2. Enable verbose logs: open the toolbar popup → turn on **Debug logging (dev)** (or run
   `chrome.storage.local.set({ pf_config: { overlayEnabled: true, energyPerTokenMultiplier: 1, debug: true } })`
   in a chat tab's console and reload). Logs are prefixed `[PromptFootprint]`.

## ChatGPT lifecycle (the previously broken case — new chat + thinking/High mode)
With Debug logging on and DevTools console open on the ChatGPT tab:
1. **New chat**, model **High** (GPT-5.5). Type a prompt and **click send** (then repeat with
   **Enter**). Expected console sequence:
   - `prompt captured at submit — trigger=send-button len=… → generation started`
   - `URL changed during active capture — keeping capture alive: …/c/<id>` (this is the bug fix:
     the new-chat URL change no longer aborts capture)
   - repeated `poll: still generating (signal=stop-button)` throughout "Thinking"/"Searching"
   - `generation ended — assistant text len=… responseTimeMs=…`
   - `storage write ok — session … tokens …`
2. The floating pill stays **"Recording…"** through the entire thinking phase and flips to
   **"Saved"** only after the final answer completes. It must **not** show "Saved" with 0 queries
   mid-thinking.
3. Dashboard → **Sessions**: exactly **one** new query with **non-zero prompt and response
   tokens**; the query count increases by one (no duplicates).
4. Repeat in an **existing** chat. Confirm a 0-token interaction is never saved (you'll see
   `skip: 0-token interaction` only if it ever occurs).

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

## Optional accounts & sync (Phase 2)
Prerequisite: a configured Supabase project (see `docs/BACKEND_DEPLOYMENT.md`). If
Supabase is **not** configured, the Account section shows "Accounts aren't set up
in this build" and everything else keeps working — verify that first.

1. **Local-only unaffected.** With no account, confirm tracking, savings, spell
   check, and the dashboard all work exactly as before. Nothing should prompt you
   to log in.
2. **Sign up + verify.** Dashboard → **Settings → Account** → *Create account*.
   You should see "Check your email to confirm". Confirm via the email, then log in.
3. **Claim + sync.** After first login, open the Supabase table editor: your
   existing local sessions/savings/settings appear under your `user_id` (numbers
   only — no prompt text columns exist). Confirm `profiles.anon_client_id` matches
   `pf_userId`.
4. **No double-count.** Note your Savings totals. Click **Sync now** several times
   and reload — the totals must not change. (Idempotent upserts + derived totals.)
5. **Cross-device.** Log in on a second Chrome profile; confirm your sessions and
   savings appear there. Realize new savings on each, sync both, and confirm no
   day is double-counted.
6. **Offline fallback.** Go offline (DevTools → Network → Offline). Tracking and
   savings still record locally; the Account pill reads "Signed in (offline)";
   "Sync now" fails quietly and retries later. No data is lost.
7. **Logout keeps local data.** Log out — the dashboard still shows your local
   sessions/savings, and tracking still works. Only the session was cleared.
8. **Privacy check.** In DevTools → Network while typing and syncing, confirm no
   request body to `*.supabase.co` contains prompt/response text or the Gemini key.
9. **Delete account.** *Delete account* removes your rows from Supabase (verify in
   the table editor) and returns you to local-only mode; local data remains until
   you clear it.
10. **RLS.** With a second account, confirm from the Supabase SQL editor
    (impersonating each user's JWT) that neither can read the other's rows, or run
    `supabase test db`.
