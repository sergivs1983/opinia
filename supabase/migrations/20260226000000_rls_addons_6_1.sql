-- ============================================================
-- OpinIA Security Bloc 6.1 — RLS Add-ons
-- Versiona 2 taules que ja tenien RLS aplicat manualment:
--   1) public.business_memberships
--   2) public._memberships_default_backup_20260220
-- ============================================================
-- SAFE / IDEMPOTENT
--   DROP POLICY IF EXISTS abans de cada CREATE POLICY
--   ALTER TABLE … ENABLE ROW LEVEL SECURITY és idempotent
-- ============================================================

-- ------------------------------------------------------------
-- 1) public.business_memberships
--    SELECT: cada usuari veu només les seves pròpies files (user_id = auth.uid())
--    INSERT / UPDATE / DELETE: bloquejats — ús exclusiu de service_role
-- ------------------------------------------------------------
alter table public.business_memberships enable row level security;

drop policy if exists "business_memberships_biz_select" on public.business_memberships;
drop policy if exists "business_memberships_biz_insert" on public.business_memberships;
drop policy if exists "business_memberships_biz_update" on public.business_memberships;
drop policy if exists "business_memberships_biz_delete" on public.business_memberships;

create policy "business_memberships_biz_select"
  on public.business_memberships
  for select
  using (user_id = auth.uid());

create policy "business_memberships_biz_insert"
  on public.business_memberships
  for insert
  with check (false);  -- bloquejat: provisioning via service_role

create policy "business_memberships_biz_update"
  on public.business_memberships
  for update
  using (false);  -- bloquejat

create policy "business_memberships_biz_delete"
  on public.business_memberships
  for delete
  using (false);  -- bloquejat

-- ------------------------------------------------------------
-- 2) public._memberships_default_backup_20260220
--    Taula de backup — deny-all per a tots els rols JWT.
--    Només service_role (que bypassa RLS per defecte) pot llegir-la.
-- ------------------------------------------------------------
alter table public._memberships_default_backup_20260220 enable row level security;

drop policy if exists "memberships_backup_deny_select" on public._memberships_default_backup_20260220;
drop policy if exists "memberships_backup_deny_insert" on public._memberships_default_backup_20260220;
drop policy if exists "memberships_backup_deny_update" on public._memberships_default_backup_20260220;
drop policy if exists "memberships_backup_deny_delete" on public._memberships_default_backup_20260220;

create policy "memberships_backup_deny_select"
  on public._memberships_default_backup_20260220
  for select
  using (false);  -- deny-all: cap usuari JWT pot llegir

create policy "memberships_backup_deny_insert"
  on public._memberships_default_backup_20260220
  for insert
  with check (false);  -- deny-all

create policy "memberships_backup_deny_update"
  on public._memberships_default_backup_20260220
  for update
  using (false);  -- deny-all

create policy "memberships_backup_deny_delete"
  on public._memberships_default_backup_20260220
  for delete
  using (false);  -- deny-all

-- ------------------------------------------------------------
-- Reload PostgREST schema cache
-- ------------------------------------------------------------
notify pgrst, 'reload schema';
