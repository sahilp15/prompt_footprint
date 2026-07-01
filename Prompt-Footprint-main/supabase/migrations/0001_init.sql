-- =====================================================================
-- PromptFootprint — optional accounts & sync schema (Phase 2)
--
-- Design goals:
--   * The extension ships only the Supabase URL + anon key. Both are public.
--     Safety comes from Row-Level Security: every row is locked to its owner,
--     so a leaked anon key can't read or write another user's data.
--   * No raw prompt/response text is ever stored. There is no text column.
--   * Idempotent sync: sessions key on the client session UUID, savings key on
--     (user_id, day). Re-syncing overwrites the same rows; it never appends,
--     so savings cannot be double-counted.
--   * Server-side validation via typed columns + CHECK constraints (no Edge
--     Function needed).
--
-- snake_case matches the legacy server/ models. Apply with the Supabase CLI:
--   supabase db push        (or run this file in the SQL editor)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Profile (1:1 with auth.users). Records the anonymous install id that
--    the user "claimed" on first login, so prior local data has a home.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  anon_client_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) Synced settings — NON-SENSITIVE ONLY.
--    Never the Gemini key, never the proxy URL, never UI positions.
-- ---------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id                     uuid primary key references auth.users(id) on delete cascade,
  overlay_enabled             boolean not null default true,
  writing_checks_enabled      boolean not null default true,
  energy_per_token_multiplier real    not null default 1.0
                              check (energy_per_token_multiplier > 0
                                     and energy_per_token_multiplier <= 20),
  updated_at                  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) Per-session stats summaries — NO raw text, no per-query rows.
--    session_id is the client-generated UUID from storage.js createSession().
--    Composite PK (user_id, session_id) makes upsert idempotent.
-- ---------------------------------------------------------------------
create table if not exists public.session_stats (
  user_id                uuid not null references auth.users(id) on delete cascade,
  session_id             uuid not null,
  platform               text not null default 'unknown'
                         check (platform in ('chatgpt', 'claude', 'unknown')),
  start_time             timestamptz not null,
  end_time               timestamptz,
  total_tokens           integer          not null default 0 check (total_tokens >= 0),
  total_energy_wh        double precision not null default 0 check (total_energy_wh >= 0),
  total_water_ml         double precision not null default 0 check (total_water_ml >= 0),
  total_co2_g            double precision not null default 0 check (total_co2_g >= 0),
  total_response_time_ms bigint           not null default 0 check (total_response_time_ms >= 0),
  query_count            integer          not null default 0 check (query_count >= 0),
  updated_at             timestamptz not null default now(),
  primary key (user_id, session_id)
);
create index if not exists session_stats_user_start_idx
  on public.session_stats (user_id, start_time desc);

-- ---------------------------------------------------------------------
-- 4) Realized savings — DAILY aggregate keyed by (user_id, day).
--    We sync the per-day series (authoritative); running totals are derived
--    client-side by summing days, so they can't double-count.
-- ---------------------------------------------------------------------
create table if not exists public.savings_daily (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  count      integer          not null default 0 check (count >= 0),
  tokens     integer          not null default 0 check (tokens >= 0),
  energy_wh  double precision not null default 0 check (energy_wh >= 0),
  water_ml   double precision not null default 0 check (water_ml >= 0),
  co2_g      double precision not null default 0 check (co2_g >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------
-- Row-Level Security: owner-only for every verb on every table.
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.user_settings enable row level security;
alter table public.session_stats enable row level security;
alter table public.savings_daily enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_select on public.profiles for select using (auth.uid() = user_id);
create policy profiles_insert on public.profiles for insert with check (auth.uid() = user_id);
create policy profiles_update on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy profiles_delete on public.profiles for delete using (auth.uid() = user_id);

-- user_settings
drop policy if exists settings_select on public.user_settings;
drop policy if exists settings_insert on public.user_settings;
drop policy if exists settings_update on public.user_settings;
drop policy if exists settings_delete on public.user_settings;
create policy settings_select on public.user_settings for select using (auth.uid() = user_id);
create policy settings_insert on public.user_settings for insert with check (auth.uid() = user_id);
create policy settings_update on public.user_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy settings_delete on public.user_settings for delete using (auth.uid() = user_id);

-- session_stats
drop policy if exists sessions_select on public.session_stats;
drop policy if exists sessions_insert on public.session_stats;
drop policy if exists sessions_update on public.session_stats;
drop policy if exists sessions_delete on public.session_stats;
create policy sessions_select on public.session_stats for select using (auth.uid() = user_id);
create policy sessions_insert on public.session_stats for insert with check (auth.uid() = user_id);
create policy sessions_update on public.session_stats for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy sessions_delete on public.session_stats for delete using (auth.uid() = user_id);

-- savings_daily
drop policy if exists savings_select on public.savings_daily;
drop policy if exists savings_insert on public.savings_daily;
drop policy if exists savings_update on public.savings_daily;
drop policy if exists savings_delete on public.savings_daily;
create policy savings_select on public.savings_daily for select using (auth.uid() = user_id);
create policy savings_insert on public.savings_daily for insert with check (auth.uid() = user_id);
create policy savings_update on public.savings_daily for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy savings_delete on public.savings_daily for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Auto-provision profile + settings rows when a new auth user is created,
-- so the client never has to bootstrap them before its first upsert.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Self-service account deletion. A signed-in user can delete their own
-- auth record; the on-delete-cascade FKs above remove all of their rows
-- in profiles/user_settings/session_stats/savings_daily. Called from the
-- dashboard "Delete account" button via supabase.rpc('delete_user').
-- ---------------------------------------------------------------------
create or replace function public.delete_user()
returns void
language sql
security definer
set search_path = public
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;
