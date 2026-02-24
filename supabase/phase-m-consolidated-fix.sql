-- ============================================================
-- OpinIA — Consolidated Fix Migration
-- 
-- Fixes 3 bugs:
--   1) Onboarding: missing columns (supported_languages, etc.)
--   2) Team: FK memberships→profiles for PostgREST joins
--   3) Team: profiles RLS for teammate visibility
--
-- Idempotent. Safe to run multiple times.
-- Run: psql $DATABASE_URL -f phase-m-consolidated-fix.sql
-- Or paste into Supabase SQL Editor.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1) MISSING BUSINESS COLUMNS
--    These exist in TypeScript types and onboarding insert
--    but were never added to the DB if schema-v2-extensions.sql
--    wasn't run.
-- ────────────────────────────────────────────────────────────
alter table public.businesses
  add column if not exists tone_keywords_positive  text[] not null default array[]::text[],
  add column if not exists tone_keywords_negative  text[] not null default array[]::text[],
  add column if not exists supported_languages     text[] not null default array['ca','es','en']::text[],
  add column if not exists response_max_length     integer not null default 1500,
  add column if not exists auto_publish_enabled    boolean not null default false,
  add column if not exists auto_publish_min_rating integer default 4;


-- ────────────────────────────────────────────────────────────
-- 2) FK: memberships.user_id → profiles.id
--    PostgREST needs a DIRECT FK to a public.* table to resolve
--    nested select syntax: profile:profiles(full_name, avatar_url)
--    Without this: "Could not find a relationship between
--    'memberships' and 'profiles' in the schema cache"
-- ────────────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'memberships_user_id_profiles_fk'
      and table_name = 'memberships'
  ) then
    alter table public.memberships
      add constraint memberships_user_id_profiles_fk
      foreign key (user_id) references public.profiles(id)
      on delete cascade;
    raise notice 'FK memberships_user_id_profiles_fk created';
  else
    raise notice 'FK memberships_user_id_profiles_fk already exists';
  end if;
end $$;


-- ────────────────────────────────────────────────────────────
-- 3) PROFILES RLS: allow teammates to see each other
--    Current: profiles_select → id = auth.uid() (ONLY self)
--    Problem: Team tab loads profiles of OTHER members → RLS
--    blocks silently → all names show as null.
--    Fix: additive policy (OR semantics in Postgres).
-- ────────────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'profiles' and policyname = 'profiles_select_teammates'
  ) then
    create policy "profiles_select_teammates" on public.profiles
      for select using (
        id in (
          select m.user_id
          from public.memberships m
          where m.org_id in (select public.user_org_ids())
            and m.accepted_at is not null
        )
      );
    raise notice 'Policy profiles_select_teammates created';
  else
    raise notice 'Policy profiles_select_teammates already exists';
  end if;
end $$;


-- ────────────────────────────────────────────────────────────
-- 4) INDEX for FK performance
-- ────────────────────────────────────────────────────────────
create index if not exists idx_memberships_user_id
  on public.memberships(user_id);


-- ────────────────────────────────────────────────────────────
-- 5) RELOAD PostgREST schema cache
--    Critical: PostgREST caches FKs. After adding the FK,
--    it won't know about the new relationship until reloaded.
--    This pg_notify tells PostgREST to reload immediately.
-- ────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';

-- Verify (optional):
-- select pg_notify('pgrst', 'reload schema');
-- If on Supabase Cloud: Dashboard → Settings → API → "Reload Schema Cache"
