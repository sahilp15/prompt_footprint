-- RLS policy test (pgTAP). Run against a local Supabase DB:
--   supabase test db
--
-- Proves the core guarantee: with an authenticated user's JWT, a user can only
-- see and write their own rows, and cannot read another user's rows. This is
-- the check that makes shipping the anon key safe.
--
-- These tests can't run in the Node (node:test) suite because they need a real
-- Postgres with the auth schema; that's why the client-side sync/merge/auth
-- logic is unit-tested separately (see extension/test/*.test.js).

begin;
select plan(6);

-- Two fake auth users.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com');

-- Act as user A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- A can insert its own session summary.
select lives_ok($$
  insert into public.session_stats (user_id, session_id, start_time)
  values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), now())
$$, 'user A can insert its own session_stats');

-- A cannot insert a row owned by B (WITH CHECK rejects it).
select throws_ok($$
  insert into public.session_stats (user_id, session_id, start_time)
  values ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), now())
$$, '42501', null, 'user A cannot insert a row owned by user B');

-- A sees only its own session rows.
select is(
  (select count(*)::int from public.session_stats),
  1,
  'user A sees only its own session_stats'
);

-- Seed a row for B via the service_role (bypasses RLS) to test cross-user reads.
set local role postgres;
insert into public.savings_daily (user_id, day, count, tokens)
values ('22222222-2222-2222-2222-222222222222', current_date, 1, 10);

-- Back to A: A cannot see B's savings.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.savings_daily),
  0,
  'user A cannot read user B savings_daily'
);

-- A's own settings row was auto-created by the trigger on signup.
set local role postgres;
select is(
  (select count(*)::int from public.user_settings
   where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'handle_new_user() auto-created settings for A'
);

-- RLS is enabled on the savings table.
select is(
  (select relrowsecurity from pg_class where relname = 'savings_daily'),
  true,
  'RLS is enabled on savings_daily'
);

select * from finish();
rollback;
