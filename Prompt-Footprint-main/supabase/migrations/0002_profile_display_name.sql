-- ---------------------------------------------------------------------
-- 0002 — Optional display name on profiles.
--
-- Adds a nullable display_name so signed-in users can be greeted by name
-- ("Hello, Sahil"). Nullable with no default keeps this fully backwards
-- compatible: existing profiles and the handle_new_user() trigger (which inserts
-- only user_id) are unaffected, and the value stays NULL until a user sets one.
--
-- No new RLS is needed — the existing owner-only policies on public.profiles
-- (auth.uid() = user_id for select/insert/update) already govern this column.
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists display_name text;

-- Keep names sane: trim to a reasonable length at the DB layer too.
alter table public.profiles
  drop constraint if exists profiles_display_name_len;
alter table public.profiles
  add constraint profiles_display_name_len
  check (display_name is null or char_length(display_name) <= 80);
