# PromptFootprint — Security Notes

_Last updated: 2026-07-01_

This document describes the security model of PromptFootprint and how to report
issues. It covers the extension, the optional Gemini writing proxy, and the
optional Supabase account/sync backend.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue:

- Email (placeholder — replace before publishing): `security@promptfootprint.app`
- Or open a GitHub security advisory on the repository.

Give us a reasonable window to fix the issue before public disclosure. We'll
acknowledge and keep you updated.

## Trust boundaries

- **Content scripts** run on `chatgpt.com` / `claude.ai` and only read page text to
  count tokens and run local checks. They never see auth tokens or the Gemini key.
- **The service worker** (background) is the only privileged context: it makes the
  optional Gemini proxy request and, if you sign in, owns the Supabase session. Auth
  tokens live in `chrome.storage.local` (per-profile, not reachable by page content
  scripts).
- **The dashboard** (options page) talks to the service worker by message passing;
  it never holds the Supabase service key or the Gemini key.

## Secrets — what is where

| Secret | Where it lives | Bundled in the extension? |
|--------|----------------|---------------------------|
| Supabase project URL | public constant | Yes (public value) |
| Supabase **anon/publishable** key | public constant | Yes — safe, because row-level security restricts every row to its owner |
| Supabase **service_role** key | local admin/deploy env only (`supabase/.env`, gitignored) | **Never** |
| `GEMINI_API_KEY` | Cloudflare Worker secret | **Never** |
| A user's own optional Gemini key | that user's `chrome.storage.local` | Never leaves their device; never synced |

There are **no hardcoded private keys** in the extension source.

## Backend (Supabase) security model

- **Row-Level Security (RLS)** is enabled on every table, with owner-only policies
  (`auth.uid() = user_id`) for select/insert/update/delete. A shipped anon key
  cannot read or write another user's rows.
- **Server-side validation** is enforced by typed columns and `CHECK` constraints
  (non-negative metrics, bounded multiplier, platform enum). No raw-text column
  exists anywhere in the schema.
- **Auth** is email + password via Supabase, with email verification and built-in
  rate limiting on auth endpoints.
- **Transport** is HTTPS only. The manifest `connect-src` allowlists exactly the
  Supabase project origin and the `*.workers.dev` proxy — nothing else.
- **Least privilege:** the extension only ever uses the anon key + a per-user JWT.
  Admin operations that need the service_role key run locally from a gitignored
  `.env`, never from the extension.

## Gemini proxy security model

- The Cloudflare Worker holds `GEMINI_API_KEY` as a secret; the extension only knows
  the Worker's URL.
- The Worker validates request shape and input size and rate-limits per IP.
- Draft text is forwarded to Gemini to generate a suggestion and is not stored.

## Content Security Policy

The extension pages use a strict MV3 CSP: `script-src 'self' 'wasm-unsafe-eval'`
(the WASM allowance is for the bundled spell-checker), no remote scripts, no
`eval` of JavaScript, `object-src 'none'`, `frame-src 'none'`, and `connect-src`
limited to `'self'`, the Gemini proxy, and the Supabase project.

## Error handling and logging

Failures in the proxy and sync paths are swallowed and, at most, logged to the
user's own console when the debug toggle is on. Auth tokens, the Gemini key, and
prompt/reply text are never logged.
