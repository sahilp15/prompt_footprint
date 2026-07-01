# Backend Deployment Guide (Supabase)

How to stand up the optional accounts/sync backend. The extension works fully
without this — follow these steps only if you want cross-device sync.

Everything here is public-value configuration except the `service_role` key and
DB password, which stay local and are never committed.

## 1. Create a Supabase project

1. Sign up at <https://supabase.com> and create a project.
2. Note your **Project URL** (`https://<PROJECT_REF>.supabase.co`) and, under
   **Project Settings → API**, the **anon/public** key and the **service_role**
   key.

## 2. Apply the schema

Option A — Supabase CLI (recommended):

```bash
cd Prompt-Footprint-main
supabase link --project-ref <PROJECT_REF>
supabase db push        # applies supabase/migrations/0001_init.sql
```

Option B — SQL editor: paste the contents of
`supabase/migrations/0001_init.sql` into the project's SQL editor and run it.

This creates the four tables (`profiles`, `user_settings`, `session_stats`,
`savings_daily`), enables Row-Level Security with owner-only policies, and adds
the `handle_new_user` trigger and `delete_user` RPC.

## 3. Configure auth

In **Authentication → Providers → Email**: enable **Email** with
**Confirm email** on (matches the extension's verify-then-login flow). No OAuth
redirect setup is needed for email + password.

**Set up a real email sender before launch.** Supabase's built-in/shared email
service is meant for early testing only — it's capped at a handful of emails
per hour project-wide, and signups will start failing with "email rate limit
exceeded" almost immediately once more than a couple of people try to sign up.
Before publishing:

1. Sign up for an SMTP provider with a free tier — [Resend](https://resend.com)
   is a common, simple pairing with Supabase.
2. Verify a sending domain (or use the provider's test sender while developing).
3. Get an API key/SMTP credentials from the provider.
4. In Supabase: **Authentication → Emails → SMTP Settings** → enable custom
   SMTP and fill in the host/port/username/password from your provider (for
   Resend: host `smtp.resend.com`, port `465`, username `resend`, password =
   your Resend API key) and a verified sender address.

**Stuck on the shared limit while testing locally?** You don't have to wait for
it to reset — a matching `auth.users` row is usually created even when the
confirmation email fails to send, so you can confirm it manually from the SQL
editor and keep testing:

```sql
update auth.users set email_confirmed_at = now() where email = 'you@example.com';
```

Then log in with that email/password directly; this is only for local testing
against your own project and has no effect on other users.

**Also set the Site URL** (Authentication → URL Configuration) to a real page —
it defaults to `http://localhost:3000`, which will show a "site can't be
reached" error after a user confirms their email. Point it at your GitHub
Pages stats site (`https://<username>.github.io/<repo>/`) or another page you
control; the confirmation itself already succeeds before this redirect fires,
so this only affects what the user sees afterward.

## 4. Wire the keys into the extension

Both values are public (safe by RLS). Set them in **two** places:

1. `extension/lib/supabaseClient.js` — fill in `SUPABASE_URL` and
   `SUPABASE_ANON_KEY` (the service worker's client).
2. `stats-site/.env` — copy from `stats-site/.env.example` and set
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then rebuild the dashboard.

Never put the `service_role` key in either place. For local admin/migration
scripts only, copy `supabase/.env.example` to `supabase/.env` (gitignored) and
fill in `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_PASSWORD`.

## 5. Rebuild and reload

```bash
cd stats-site
npm run build -- --outDir ../extension/dashboard --emptyOutDir
```

Then reload the extension at `chrome://extensions`.

## 6. Tighten before publishing

- In `manifest.json`, the `host_permissions` and CSP `connect-src` use
  `https://*.supabase.co`. For least privilege, narrow both to your exact
  project origin (`https://<PROJECT_REF>.supabase.co`) before packing for the
  Chrome Web Store.
- Confirm the `service_role` key is not present anywhere under `extension/` or
  `stats-site/` (search the build output).

## 7. Verify RLS

With a local Supabase or the hosted project:

```bash
supabase test db        # runs supabase/tests/rls.test.sql (pgTAP)
```

Or manually: sign up as user A and user B, and confirm from the SQL editor
(impersonating each JWT) that neither can read the other's rows.

## Costs & scaling

Supabase's free tier covers early usage. Sync volume is low (a handful of
upserts per user per sync, hourly at most), so Postgres load stays modest;
scale the instance up if your user base grows.
