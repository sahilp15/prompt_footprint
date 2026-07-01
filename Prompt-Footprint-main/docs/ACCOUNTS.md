# Proposal: Optional User Accounts & Cross-Device Sync

_Status: proposal only — not implemented. Core fixes (tracking, savings, popup,
branding) take priority._

## Today

PromptFootprint is **local-first**: each install gets an anonymous UUID
(`pf_userId`) and all data lives in `chrome.storage.local`. There is no login.
Data does not sync across devices or survive a profile reset. A legacy Express +
Postgres server exists under `server/` (with `Session`, `Query`, `Config` Sequelize
models) but is currently unused.

## Goal

Let a user optionally sign in so their PromptFootprint data follows them across
browsers/devices — **without weakening the local-first, privacy-preserving
default** for users who don't sign in.

## Recommended approach

1. **Keep local-first as the default.** Accounts are strictly opt-in. Anonymous
   users see no change.
2. **Revive the existing `server/`** rather than adding a new stack — the data
   models already match the on-device schema. Add:
   - An `auth` layer: passwordless **email magic-link** (lowest friction, no
     password storage) or **Google OAuth**. Issue a short-lived JWT + refresh token.
   - A `users` table; link the existing anonymous `pf_userId` to a `user_id` on
     first sign-in so prior local data can be claimed.
3. **Sync model:** on sign-in, push local sessions/savings to the server and pull
   the merged set back. Use last-write-wins per session id (sessions are
   append-only, so conflicts are rare). Continue writing locally first, then sync
   in the background, so the extension keeps working offline.
4. **Storage of tokens:** keep auth tokens in `chrome.storage.local` (per-profile,
   not exposed to page content scripts). Never store them in page-accessible
   storage.

## Security / privacy requirements

- All sync traffic over HTTPS; CORS already restricted in `server/` — extend the
  allowlist to the extension origin only.
- Continue to **never transmit prompt/response text** — sync only counts and
  metrics, consistent with the current privacy stance.
- Make account deletion + data export available (also helps store compliance).
- Disclose the optional cloud sync in the privacy policy when this ships.

## Why not a third-party BaaS (Supabase/Firebase)?

Viable and faster to stand up, but it adds a new vendor, new data-processor
disclosure, and duplicates models we already have. Prefer reusing `server/`
unless hosting/maintenance cost argues otherwise.

## Scope estimate

Auth + users table + claim-on-signin + background sync is a multi-day effort and
touches the server, the extension background worker, and the dashboard. It should
be a separate, well-tested change after the current correctness work lands.
