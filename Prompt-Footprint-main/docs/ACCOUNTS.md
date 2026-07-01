# Optional Accounts & Cross-Device Sync

_Status: implemented (Phase 2). Optional and off by default — signed-out use is
unchanged. This supersedes the earlier proposal in this file, which recommended
reviving the legacy `server/`._

## Decision

PromptFootprint uses **Supabase** (managed Postgres + Auth + Row-Level Security)
for optional accounts and sync, with **email + password** sign-in.

Why Supabase over reviving `server/`:

- It provides email verification, password reset, refresh-token rotation, and
  auth rate limiting out of the box — all the parts that are easy to get wrong
  when hand-rolled on Express.
- Row-Level Security expresses least-privilege declaratively in SQL, so the
  shipped anon key is safe: every row is locked to its owner.
- Less code to write, host, and maintain for a solo project going public.

Trade-off: Supabase is one additional data sub-processor, disclosed in
[PRIVACY.md](./PRIVACY.md).

## What syncs (and what never does)

Syncs when signed in:
- Non-sensitive settings (overlay on/off, writing checks on/off, energy multiplier).
- Per-session **summaries**: token counts, timing, and estimated energy/water/CO₂
  — **numbers only, no prompt/response text**.
- Realized savings as a **per-day** total.

Never syncs (by construction):
- Prompt/response text — never stored locally, never uploaded.
- The Gemini API key and the Worker URL.
- Overlay/optimizer positions and the debug flag.

The uploaded payload is built by a whitelist-only function
(`extension/lib/syncPayload.js`), so the exclusion is structural, not a filter
that can be forgotten. See `extension/test/syncPayload.test.js`.

## How it works

- The **service worker** owns the Supabase client and session; the dashboard
  drives auth/sync by message passing and never sees the tokens. The session is
  stored in `chrome.storage.local` under `pf_auth` via a custom adapter
  (`extension/lib/supabaseClient.js`), which is per-profile and not reachable by
  content scripts.
- **Sync is idempotent.** Sessions upsert on `(user_id, session_id)`; savings
  upsert on `(user_id, day)`. Running totals are recomputed from the daily map,
  never accumulated, so re-syncing cannot double-count
  (`extension/lib/syncMerge.js`).
- **First login runs a one-time "claim"** that records the anonymous install id
  and pushes existing local data up. It's guarded by `pf_auth.claimedFor`, and
  because every write is an upsert on a stable key, re-running is harmless.
- **Local-first is preserved.** Writes always go local first; sync is best-effort
  off explicit triggers (dashboard open, "Sync now", an hourly alarm). On any
  failure it returns quietly and never wipes local data. Logging out clears only
  the session; all `pf_*` data stays.

## Data model

Four owner-scoped tables in `supabase/migrations/0001_init.sql`: `profiles`,
`user_settings`, `session_stats`, `savings_daily` — all with RLS enabled and
`auth.uid() = user_id` policies. A `handle_new_user` trigger provisions the
profile + settings rows on signup; a `delete_user` RPC powers self-service
account deletion (cascades to every table).

## Multi-device trade-off

Savings are a per-day aggregate merged by keeping the larger realized total per
day, not the sum. If two devices realize savings on the same day while offline,
that day reflects the larger of the two, never the sum — an under-count at worst,
never a double-count. Exact cross-device summation would need a per-device grain
and is out of scope for this version.

## Setup

See [BACKEND_DEPLOYMENT.md](./BACKEND_DEPLOYMENT.md) for provisioning, running the
migration, and wiring the keys.
