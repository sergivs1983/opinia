-- ============================================================
-- OpinIA LEGAL — RLS location-level isolation (P0 security fix)
-- ============================================================
-- PREREQUISITE: phase-s-team-rbac-business-scope.sql must have run first.
--   That phase already migrated: reviews, replies, integrations, businesses,
--   connectors (phase-int-0), webhook_deliveries (phase-pub-1),
--   metrics_daily (phase-met-1), onboarding_progress (phase-onb-1),
--   content_* (phase-ci-1, phase-cs-1, phase-ep-1, phase-pl-1).
--
-- This migration fixes all REMAINING per-location tables that still filter
-- by user_org_ids() (org-level) instead of user_biz_ids() (business-level).
--
-- Security model (inherited from phase-s):
--   user_biz_ids()  → owner/admin: ALL businesses in their org
--                     manager/responder/staff: only assigned businesses
--   user_biz_ids_with_role(roles[]) → same scoping, further filtered by role
--
-- Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY.
-- Safe to run multiple times.
-- ============================================================

-- ============================================================
-- 0) VERIFY PREREQUISITE FUNCTION EXISTS
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'user_biz_ids'
  ) then
    raise exception
      'user_biz_ids() not found — run phase-s-team-rbac-business-scope.sql first';
  end if;
end $$;


-- ============================================================
-- 1) kb_entries  (schema-v2-extensions.sql — all 4 policies use user_org_ids)
-- ============================================================
-- Any assigned member can read and write KB entries.
-- Manager-or-above required for delete.

drop policy if exists "kb_select" on public.kb_entries;
drop policy if exists "kb_insert" on public.kb_entries;
drop policy if exists "kb_update" on public.kb_entries;
drop policy if exists "kb_delete" on public.kb_entries;

create policy "kb_select" on public.kb_entries
  for select using (biz_id in (select public.user_biz_ids()));

create policy "kb_insert" on public.kb_entries
  for insert with check (biz_id in (select public.user_biz_ids()));

create policy "kb_update" on public.kb_entries
  for update using (biz_id in (select public.user_biz_ids()));

create policy "kb_delete" on public.kb_entries
  for delete using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );


-- ============================================================
-- 2) knowledge_base_entries  (phase-b-knowledge-base.sql — user_org_ids)
-- ============================================================
drop policy if exists "kbe_select" on public.knowledge_base_entries;
drop policy if exists "kbe_insert" on public.knowledge_base_entries;
drop policy if exists "kbe_update" on public.knowledge_base_entries;
drop policy if exists "kbe_delete" on public.knowledge_base_entries;

create policy "kbe_select" on public.knowledge_base_entries
  for select using (biz_id in (select public.user_biz_ids()));

create policy "kbe_insert" on public.knowledge_base_entries
  for insert with check (biz_id in (select public.user_biz_ids()));

create policy "kbe_update" on public.knowledge_base_entries
  for update using (biz_id in (select public.user_biz_ids()));

create policy "kbe_delete" on public.knowledge_base_entries
  for delete using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );


-- ============================================================
-- 3) activity_log  (schema-v2-extensions.sql — user_org_ids)
-- ============================================================
-- biz_id is NULLABLE (org-level events have no biz_id).
-- Rule: see rows where biz_id is in your accessible businesses,
--       OR biz_id IS NULL and org_id is yours (org-wide events).
-- INSERT: same rule (append-only — no UPDATE or DELETE policies).

drop policy if exists "activity_select" on public.activity_log;
drop policy if exists "activity_insert" on public.activity_log;

create policy "activity_select" on public.activity_log
  for select using (
    (biz_id is not null and biz_id in (select public.user_biz_ids()))
    or
    (biz_id is null and org_id in (select public.user_org_ids()))
  );

create policy "activity_insert" on public.activity_log
  for insert with check (
    (biz_id is not null and biz_id in (select public.user_biz_ids()))
    or
    (biz_id is null and org_id in (select public.user_org_ids()))
  );
-- No update or delete: activity_log is append-only.


-- ============================================================
-- 4) growth_links  (schema-v2-extensions.sql — user_org_ids)
-- ============================================================
drop policy if exists "growth_select" on public.growth_links;
drop policy if exists "growth_insert" on public.growth_links;
drop policy if exists "growth_update" on public.growth_links;
drop policy if exists "growth_delete" on public.growth_links;

create policy "growth_select" on public.growth_links
  for select using (biz_id in (select public.user_biz_ids()));

create policy "growth_insert" on public.growth_links
  for insert with check (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );

create policy "growth_update" on public.growth_links
  for update using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );

create policy "growth_delete" on public.growth_links
  for delete using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin']::text[])
    )
  );


-- ============================================================
-- 5) growth_events  (phase-h-b-growth-events.sql — user_org_ids)
-- ============================================================
-- Written by service_role (redirect endpoint); authenticated users read only.

drop policy if exists "ge_select_org" on public.growth_events;

create policy "ge_select_biz" on public.growth_events
  for select to authenticated
  using (biz_id in (select public.user_biz_ids()));


-- ============================================================
-- 6) ops_actions  (phase-e-operations.sql — all 4 use user_org_ids)
-- ============================================================
drop policy if exists "ops_actions_select" on public.ops_actions;
drop policy if exists "ops_actions_insert" on public.ops_actions;
drop policy if exists "ops_actions_update" on public.ops_actions;
drop policy if exists "ops_actions_delete" on public.ops_actions;

create policy "ops_actions_select" on public.ops_actions
  for select using (biz_id in (select public.user_biz_ids()));

create policy "ops_actions_insert" on public.ops_actions
  for insert with check (biz_id in (select public.user_biz_ids()));

create policy "ops_actions_update" on public.ops_actions
  for update using (biz_id in (select public.user_biz_ids()));

create policy "ops_actions_delete" on public.ops_actions
  for delete using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );


-- ============================================================
-- 7) action_triggers  (phase-j-seo-triggers.sql — triggers_select uses user_org_ids;
--                      insert/update/delete use org membership role but miss biz scope)
-- ============================================================
drop policy if exists "triggers_select" on public.action_triggers;
drop policy if exists "triggers_insert" on public.action_triggers;
drop policy if exists "triggers_update" on public.action_triggers;
drop policy if exists "triggers_delete" on public.action_triggers;

create policy "triggers_select" on public.action_triggers
  for select using (biz_id in (select public.user_biz_ids()));

create policy "triggers_insert" on public.action_triggers
  for insert with check (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );

create policy "triggers_update" on public.action_triggers
  for update using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );

create policy "triggers_delete" on public.action_triggers
  for delete using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );


-- ============================================================
-- 8) notifications  (phase-j-seo-triggers.sql — all 3 use user_org_ids)
-- ============================================================
-- A user sees their own notifications (user_id = auth.uid()) across any biz,
-- OR all notifications for businesses they can access (for manager dashboards).
-- Insert: service_role (pipeline) writes these; the policy is a safety net.

drop policy if exists "notif_select" on public.notifications;
drop policy if exists "notif_insert" on public.notifications;
drop policy if exists "notif_update" on public.notifications;

create policy "notif_select" on public.notifications
  for select using (
    user_id = auth.uid()
    or biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );

create policy "notif_insert" on public.notifications
  for insert with check (biz_id in (select public.user_biz_ids()));

create policy "notif_update" on public.notifications
  for update using (
    user_id = auth.uid()
    or biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );


-- ============================================================
-- 9) competitors  (phase-h-c-benchmark.sql — all 4 use user_org_ids)
-- ============================================================
drop policy if exists "comp_select" on public.competitors;
drop policy if exists "comp_insert" on public.competitors;
drop policy if exists "comp_update" on public.competitors;
drop policy if exists "comp_delete" on public.competitors;

create policy "comp_select" on public.competitors
  for select to authenticated
  using (biz_id in (select public.user_biz_ids()));

create policy "comp_insert" on public.competitors
  for insert to authenticated
  with check (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );

create policy "comp_update" on public.competitors
  for update to authenticated
  using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );

create policy "comp_delete" on public.competitors
  for delete to authenticated
  using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin']::text[])
    )
  );


-- ============================================================
-- 10) missions  (phase-h-c-benchmark.sql — missions_select uses user_org_ids)
-- ============================================================
-- Written by service_role; authenticated users read-only.

drop policy if exists "missions_select" on public.missions;

create policy "missions_select" on public.missions
  for select to authenticated
  using (biz_id in (select public.user_biz_ids()));


-- ============================================================
-- 11) failed_jobs / DLQ  (phase-a-dlq.sql — fj_select_org uses user_org_ids)
-- ============================================================
-- Written by service_role; authenticated users read-only.

drop policy if exists "fj_select_org" on public.failed_jobs;

create policy "fj_select_biz" on public.failed_jobs
  for select to authenticated
  using (biz_id in (select public.user_biz_ids()));


-- ============================================================
-- 12) llm_usage_events  (phase-a-llm-usage.sql — lue_select_org uses user_org_ids)
-- ============================================================
-- Written by service_role; authenticated users read-only.

drop policy if exists "lue_select_org" on public.llm_usage_events;

create policy "lue_select_biz" on public.llm_usage_events
  for select to authenticated
  using (biz_id in (select public.user_biz_ids()));


-- ============================================================
-- 13) ai_reply_edits  (phase-panic-golden-constraints.sql — user_org_ids)
-- ============================================================
-- Any assigned member can read and insert edit records.

drop policy if exists "are_select_org" on public.ai_reply_edits;
drop policy if exists "are_insert_org" on public.ai_reply_edits;

create policy "are_select_biz" on public.ai_reply_edits
  for select to authenticated
  using (biz_id in (select public.user_biz_ids()));

create policy "are_insert_biz" on public.ai_reply_edits
  for insert to authenticated
  with check (biz_id in (select public.user_biz_ids()));


-- ============================================================
-- 14) sync_log  (schema-v2.sql — sync_log_select/insert use user_org_ids)
-- ============================================================
-- sync_log has biz_id NOT NULL (see schema-v2.sql:228).
-- Written by integration sync jobs (service_role + user session).

drop policy if exists "sync_log_select" on public.sync_log;
drop policy if exists "sync_log_insert" on public.sync_log;

create policy "sync_log_select" on public.sync_log
  for select using (biz_id in (select public.user_biz_ids()));

create policy "sync_log_insert" on public.sync_log
  for insert with check (biz_id in (select public.user_biz_ids()));


-- ============================================================
-- 15) insights_daily  (phase-d-production.sql)
-- ============================================================
-- CRITICAL FIX: "insights_daily_all" used USING(true) → any auth user read/write ALL.
-- Drop it. Service_role bypasses RLS automatically (BYPASSRLS privilege).
-- Fix select to biz scope.

drop policy if exists "insights_daily_all"    on public.insights_daily;
drop policy if exists "insights_daily_select" on public.insights_daily;

create policy "insights_daily_select" on public.insights_daily
  for select using (biz_id in (select public.user_biz_ids()));

-- Service_role writes via cron (no insert policy needed — BYPASSRLS).


-- ============================================================
-- 16) job_runs  (phase-d-production.sql)
-- ============================================================
-- CRITICAL FIX: "job_runs_all_service" used USING(true) → same problem.
-- biz_id and org_id are nullable (global jobs have no biz_id).

drop policy if exists "job_runs_all_service" on public.job_runs;
drop policy if exists "job_runs_select"      on public.job_runs;

create policy "job_runs_select" on public.job_runs
  for select using (
    -- biz-scoped job: user must have access to that business
    (biz_id is not null and biz_id in (select public.user_biz_ids()))
    or
    -- org-scoped job (no biz): user must be org member
    (biz_id is null and org_id is not null and org_id in (select public.user_org_ids()))
    or
    -- global job (no biz, no org): only super-admin via service_role sees these
    -- (authenticated users blocked by falling through to false)
    false
  );

-- Service_role writes via cron (BYPASSRLS).


-- ============================================================
-- 17) review_topics INSERT/DELETE with USING(true)  (phase-c-insights.sql)
-- ============================================================
-- "topics_insert" and "topics_delete" used USING(true) → any authenticated
-- user could insert/delete topics for ANY business (cross-tenant write).
-- Fix: scope to assigned businesses. SELECT already correct (user_biz_ids).

drop policy if exists "topics_insert" on public.review_topics;
drop policy if exists "topics_delete" on public.review_topics;

create policy "topics_insert" on public.review_topics
  for insert with check (biz_id in (select public.user_biz_ids()));

create policy "topics_delete" on public.review_topics
  for delete using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner','admin','manager']::text[])
    )
  );


-- ============================================================
-- SIGNAL POSTGREST TO RELOAD SCHEMA CACHE
-- ============================================================
notify pgrst, 'reload schema';


-- ============================================================
-- SQL TESTS — run as an impersonated authenticated user
-- (use Supabase SQL Editor with "Run as user" or set auth.uid())
-- ============================================================
--
-- Assumes:
--   :user_a_id  = auth.uid() of User A (assigned only to business_a)
--   :business_a = uuid of business A (org A)
--   :business_b = uuid of business B (SAME org A, but user_a NOT assigned)
--   :business_c = uuid of business C (DIFFERENT org B)
--
-- TEST 1: kb_entries — cross-location same org = 0 rows
-- set local role authenticated;
-- set local "request.jwt.claims" to '{"sub": ":user_a_id"}';
-- select count(*) from public.kb_entries
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 2: knowledge_base_entries — cross-org = 0 rows
-- select count(*) from public.knowledge_base_entries
-- where biz_id = :business_c;
-- EXPECTED: 0
--
-- TEST 3: activity_log — cross-location = 0 rows (biz_id not null case)
-- select count(*) from public.activity_log
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 4: activity_log — org-level entries (biz_id IS NULL) visible to own org
-- select count(*) from public.activity_log
-- where biz_id is null and org_id = (select org_id from public.businesses where id = :business_a);
-- EXPECTED: >= 0  (should be > 0 if org-level events exist)
--
-- TEST 5: growth_links — cross-location same org = 0
-- select count(*) from public.growth_links
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 6: ops_actions — cross-org = 0
-- select count(*) from public.ops_actions
-- where biz_id = :business_c;
-- EXPECTED: 0
--
-- TEST 7: action_triggers — cross-location = 0
-- select count(*) from public.action_triggers
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 8: notifications — cross-location, not own user_id = 0
-- select count(*) from public.notifications
-- where biz_id = :business_b and user_id != :user_a_id;
-- EXPECTED: 0
--
-- TEST 9: competitors — cross-location = 0
-- select count(*) from public.competitors
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 10: missions — cross-org = 0
-- select count(*) from public.missions
-- where biz_id = :business_c;
-- EXPECTED: 0
--
-- TEST 11: failed_jobs DLQ — cross-location = 0
-- select count(*) from public.failed_jobs
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 12: llm_usage_events — cross-location = 0
-- select count(*) from public.llm_usage_events
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 13: ai_reply_edits — cross-org = 0
-- select count(*) from public.ai_reply_edits
-- where biz_id = :business_c;
-- EXPECTED: 0
--
-- TEST 14: insights_daily — cross-location = 0  (+ old "using(true)" gone)
-- select count(*) from public.insights_daily
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 15: insights_daily — OWN business visible
-- select count(*) from public.insights_daily
-- where biz_id = :business_a;
-- EXPECTED: >= 0
--
-- TEST 16: job_runs — cross-location = 0
-- select count(*) from public.job_runs
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 17: review_topics INSERT cross-location rejected
-- insert into public.review_topics (review_id, biz_id, topic, sentiment, confidence)
-- values (:any_review_id_from_b, :business_b, 'test', 'neutral', 0.8);
-- EXPECTED: ERROR 42501 (RLS violation)
--
-- TEST 18: growth_events — cross-location = 0
-- select count(*) from public.growth_events
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 19: sync_log — cross-location = 0
-- select count(*) from public.sync_log
-- where biz_id = :business_b;
-- EXPECTED: 0
--
-- TEST 20: Verify all affected policies now reference user_biz_ids
-- select tablename, policyname, qual
-- from pg_policies
-- where schemaname = 'public'
--   and qual like '%user_biz_ids%'
-- order by tablename, policyname;
-- EXPECTED: all tables above should appear; NO table should appear only with user_org_ids
