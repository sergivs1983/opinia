-- ============================================================
-- OpinIA Security Bloc 6 — RLS Multi-Tenant
-- Zero cross-tenant data leakage
-- ============================================================
-- SAFE / IDEMPOTENT
--   DROP POLICY IF EXISTS before every CREATE POLICY
--   ALTER TABLE … ENABLE ROW LEVEL SECURITY is idempotent
--   CREATE OR REPLACE FUNCTION for helpers
-- ============================================================

-- ------------------------------------------------------------
-- 0) Enforcement: verify core tenant tables have biz_id NOT NULL
--    RAISE EXCEPTION for existing tables that are missing the column.
--    RAISE NOTICE for tables that don't exist yet (future feature branches).
-- ------------------------------------------------------------
do $$
declare
  core_biz_id_tables text[] := array[
    'reviews', 'replies', 'integrations', 'sync_log', 'ops_actions'
  ];
  nullable_biz_tables text[] := array[
    'job_runs', 'audit_runs', 'activity_log'
  ];
  t text;
  has_col boolean;
begin
  -- Core tables MUST have biz_id NOT NULL
  foreach t in array core_biz_id_tables loop
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'Table % does not exist yet — skipping enforcement check', t;
      continue;
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = t
        and column_name  = 'biz_id'
        and is_nullable  = 'NO'
    ) into has_col;

    if not has_col then
      raise exception
        'Security gate: table public.% exists but lacks biz_id NOT NULL — '
        'cannot enable safe RLS. Fix the schema first.', t
        using errcode = 'P0001';
    end if;
  end loop;

  -- Nullable biz_id tables: warn only
  foreach t in array nullable_biz_tables loop
    raise notice
      'Table % has nullable biz_id (intentional: anon/demo rows). '
      'Standard _biz_* policies are skipped. Enable RLS manually when ready.', t;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 1) user_biz_ids() — SECURITY DEFINER helper
--    Returns the set of business UUIDs the current user can access.
--    Reads business_memberships (Model A: explicit assignment required).
--    SECURITY DEFINER + SET search_path prevents search-path injection.
-- ------------------------------------------------------------
create or replace function public.user_biz_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select bm.business_id
  from public.business_memberships bm
  where bm.user_id   = auth.uid()
    and bm.is_active = true;
$$;

revoke all on function public.user_biz_ids() from public;
grant execute on function public.user_biz_ids() to authenticated;

-- ------------------------------------------------------------
-- 2) Enable RLS on all tenant tables
--    ALTER TABLE … ENABLE ROW LEVEL SECURITY is idempotent.
-- ------------------------------------------------------------

-- Core schema (schema-v2.sql)
alter table public.businesses          enable row level security;
alter table public.memberships         enable row level security;
alter table public.integrations        enable row level security;
alter table public.reviews             enable row level security;
alter table public.replies             enable row level security;
alter table public.sync_log            enable row level security;

-- business_memberships (phase-s)
alter table public.business_memberships enable row level security;

-- integrations_secrets (phase-legal-secrets — deny-all intentional)
alter table public.integrations_secrets enable row level security;

-- phase-a
alter table public.failed_jobs          enable row level security;
alter table public.llm_usage_events     enable row level security;

-- phase-b
alter table public.knowledge_base_entries enable row level security;
alter table public.kb_entries             enable row level security;
alter table public.review_topics          enable row level security;

-- phase-c / phase-ci
alter table public.insights_daily       enable row level security;
alter table public.content_insights     enable row level security;
alter table public.content_suggestions  enable row level security;

-- phase-cs
alter table public.content_assets       enable row level security;
alter table public.content_text_posts   enable row level security;
alter table public.content_planner_items enable row level security;

-- phase-e
alter table public.ops_actions          enable row level security;

-- phase-ep
alter table public.exports              enable row level security;

-- phase-h
alter table public.growth_links         enable row level security;
alter table public.growth_events        enable row level security;
alter table public.competitors          enable row level security;
alter table public.missions             enable row level security;

-- phase-met
alter table public.metrics_daily        enable row level security;

-- phase-model / phase-s
alter table public.ai_reply_edits       enable row level security;
alter table public.action_triggers      enable row level security;
alter table public.notifications        enable row level security;

-- phase-int / phase-pub
alter table public.connectors           enable row level security;
alter table public.webhook_deliveries   enable row level security;

-- phase-onb
alter table public.onboarding_progress  enable row level security;

-- phase-t
alter table public.social_posts         enable row level security;

-- ------------------------------------------------------------
-- 3) business_memberships — special policies (no recursion)
--    user_biz_ids() reads this table → MUST NOT call user_biz_ids() here.
--    Mutations are blocked: only service_role / admin scripts may write.
-- ------------------------------------------------------------
drop policy if exists business_memberships_biz_select on public.business_memberships;
drop policy if exists business_memberships_biz_insert on public.business_memberships;
drop policy if exists business_memberships_biz_update on public.business_memberships;
drop policy if exists business_memberships_biz_delete on public.business_memberships;

create policy "business_memberships_biz_select"
  on public.business_memberships
  for select
  using (user_id = auth.uid());

create policy "business_memberships_biz_insert"
  on public.business_memberships
  for insert
  with check (false);  -- blocked: use service_role for provisioning

create policy "business_memberships_biz_update"
  on public.business_memberships
  for update
  using (false);  -- blocked

create policy "business_memberships_biz_delete"
  on public.business_memberships
  for delete
  using (false);  -- blocked

-- ------------------------------------------------------------
-- 4) memberships (org-level) — user sees only own rows; mutations blocked
-- ------------------------------------------------------------
drop policy if exists memberships_biz_select on public.memberships;
drop policy if exists memberships_biz_insert on public.memberships;
drop policy if exists memberships_biz_update on public.memberships;
drop policy if exists memberships_biz_delete on public.memberships;

create policy "memberships_biz_select"
  on public.memberships
  for select
  using (user_id = auth.uid());

create policy "memberships_biz_insert"
  on public.memberships
  for insert
  with check (false);  -- blocked: use service_role for invite flows

create policy "memberships_biz_update"
  on public.memberships
  for update
  using (false);  -- blocked

create policy "memberships_biz_delete"
  on public.memberships
  for delete
  using (false);  -- blocked

-- ------------------------------------------------------------
-- 5) businesses — scoped via user_biz_ids()
--    INSERT / DELETE blocked (businesses are provisioned by service_role).
-- ------------------------------------------------------------
drop policy if exists businesses_biz_select on public.businesses;
drop policy if exists businesses_biz_insert on public.businesses;
drop policy if exists businesses_biz_update on public.businesses;
drop policy if exists businesses_biz_delete on public.businesses;

create policy "businesses_biz_select"
  on public.businesses
  for select
  using (id in (select public.user_biz_ids()));

create policy "businesses_biz_insert"
  on public.businesses
  for insert
  with check (false);  -- blocked: provisioned by service_role only

create policy "businesses_biz_update"
  on public.businesses
  for update
  using (id in (select public.user_biz_ids()))
  with check (id in (select public.user_biz_ids()));

create policy "businesses_biz_delete"
  on public.businesses
  for delete
  using (false);  -- blocked: hard-delete via service_role only

-- ------------------------------------------------------------
-- 6) biz_id tables — standard 4-policy set
--    Tables: reviews, replies, integrations, sync_log, failed_jobs,
--            llm_usage_events, knowledge_base_entries, kb_entries,
--            review_topics, growth_links, growth_events, insights_daily,
--            ops_actions, competitors, missions, ai_reply_edits,
--            action_triggers, notifications
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'reviews', 'replies', 'integrations', 'sync_log', 'failed_jobs',
    'llm_usage_events', 'knowledge_base_entries', 'kb_entries',
    'review_topics', 'growth_links', 'growth_events', 'insights_daily',
    'ops_actions', 'competitors', 'missions', 'ai_reply_edits',
    'action_triggers', 'notifications'
  ]::text[]
  loop
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'Table % not found — skipping _biz_* policies', t;
      continue;
    end if;

    execute format(
      'drop policy if exists %I on public.%I',
      t || '_biz_select', t
    );
    execute format(
      'create policy %I on public.%I for select using (biz_id in (select public.user_biz_ids()))',
      t || '_biz_select', t
    );

    execute format(
      'drop policy if exists %I on public.%I',
      t || '_biz_insert', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (biz_id in (select public.user_biz_ids()))',
      t || '_biz_insert', t
    );

    execute format(
      'drop policy if exists %I on public.%I',
      t || '_biz_update', t
    );
    execute format(
      'create policy %I on public.%I for update '
      'using (biz_id in (select public.user_biz_ids())) '
      'with check (biz_id in (select public.user_biz_ids()))',
      t || '_biz_update', t
    );

    execute format(
      'drop policy if exists %I on public.%I',
      t || '_biz_delete', t
    );
    execute format(
      'create policy %I on public.%I for delete using (biz_id in (select public.user_biz_ids()))',
      t || '_biz_delete', t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 7) business_id tables — standard 4-policy set
--    Tables: content_insights, content_suggestions, content_assets,
--            content_text_posts, content_planner_items, exports,
--            onboarding_progress, metrics_daily, connectors,
--            webhook_deliveries, social_posts
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'content_insights', 'content_suggestions', 'content_assets',
    'content_text_posts', 'content_planner_items', 'exports',
    'onboarding_progress', 'metrics_daily', 'connectors',
    'webhook_deliveries', 'social_posts'
  ]::text[]
  loop
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'Table % not found — skipping _biz_* policies', t;
      continue;
    end if;

    execute format(
      'drop policy if exists %I on public.%I',
      t || '_biz_select', t
    );
    execute format(
      'create policy %I on public.%I for select using (business_id in (select public.user_biz_ids()))',
      t || '_biz_select', t
    );

    execute format(
      'drop policy if exists %I on public.%I',
      t || '_biz_insert', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (business_id in (select public.user_biz_ids()))',
      t || '_biz_insert', t
    );

    execute format(
      'drop policy if exists %I on public.%I',
      t || '_biz_update', t
    );
    execute format(
      'create policy %I on public.%I for update '
      'using (business_id in (select public.user_biz_ids())) '
      'with check (business_id in (select public.user_biz_ids()))',
      t || '_biz_update', t
    );

    execute format(
      'drop policy if exists %I on public.%I',
      t || '_biz_delete', t
    );
    execute format(
      'create policy %I on public.%I for delete using (business_id in (select public.user_biz_ids()))',
      t || '_biz_delete', t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 8) integrations_secrets — deny-all (no policies = no access for JWT users)
--    RLS already enabled above. No policies = implicit deny for all roles.
--    Only service_role (which bypasses RLS by default) can read secrets.
--
--    SECURITY NOTE: if you want to also block service_role, run:
--      ALTER TABLE public.integrations_secrets FORCE ROW LEVEL SECURITY;
--    This is intentionally left as a manual step (Bloc 7 action item).
-- ------------------------------------------------------------
-- (no policies added — deny-all by design)

-- ------------------------------------------------------------
-- 9) Reload PostgREST schema cache
-- ------------------------------------------------------------
notify pgrst, 'reload schema';
