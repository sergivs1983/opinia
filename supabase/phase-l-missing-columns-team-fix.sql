-- ============================================================
-- OpinIA — Missing Business Columns + Team FK Fix
-- Adds columns referenced by TypeScript types but never created in SQL.
-- Also fixes memberships→profiles FK for PostgREST join.
-- Idempotent. Run AFTER schema-v2.sql and all phase-* migrations.
-- ============================================================

-- A) Missing business columns (additive, all have defaults)
do $$ begin
  -- tone_keywords_positive
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='tone_keywords_positive'
  ) then
    alter table public.businesses
      add column tone_keywords_positive text[] not null default array[]::text[];
    comment on column public.businesses.tone_keywords_positive is 'Preferred vocabulary for AI responses.';
  end if;

  -- tone_keywords_negative
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='tone_keywords_negative'
  ) then
    alter table public.businesses
      add column tone_keywords_negative text[] not null default array[]::text[];
    comment on column public.businesses.tone_keywords_negative is 'Banned vocabulary for AI responses.';
  end if;

  -- supported_languages
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='supported_languages'
  ) then
    alter table public.businesses
      add column supported_languages text[] not null default array['ca','es','en']::text[];
    comment on column public.businesses.supported_languages is 'Languages this business supports for AI responses.';
  end if;

  -- response_max_length
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='response_max_length'
  ) then
    alter table public.businesses
      add column response_max_length integer not null default 500;
    comment on column public.businesses.response_max_length is 'Max character length for AI-generated responses.';
  end if;

  -- auto_publish_enabled
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='auto_publish_enabled'
  ) then
    alter table public.businesses
      add column auto_publish_enabled boolean not null default false;
    comment on column public.businesses.auto_publish_enabled is 'When true, approved replies auto-publish to review platform.';
  end if;

  -- auto_publish_min_rating
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='auto_publish_min_rating'
  ) then
    alter table public.businesses
      add column auto_publish_min_rating integer;
    comment on column public.businesses.auto_publish_min_rating is 'Minimum star rating for auto-publishing.';
  end if;
end $$;


-- B) FK from memberships.user_id → profiles.id for PostgREST nested selects
-- (memberships already has FK to auth.users, but PostgREST needs FK to a
--  public.* table to resolve the join syntax profile:profiles(...))
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
  end if;
end $$;


-- C) Extend profiles RLS: allow org teammates to see each other's profiles
-- Current policy profiles_select: id = auth.uid() (only self)
-- New policy (additive — OR semantics): teammates can see names
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'profiles' and policyname = 'profiles_select_teammates'
  ) then
    create policy "profiles_select_teammates" on public.profiles
      for select using (
        id in (
          select m2.user_id
          from public.memberships m2
          where m2.org_id in (select public.user_org_ids())
            and m2.accepted_at is not null
        )
      );
  end if;
end $$;


-- D) Index for FK performance
create index if not exists idx_memberships_user_id on public.memberships(user_id);


-- E) Reload PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
