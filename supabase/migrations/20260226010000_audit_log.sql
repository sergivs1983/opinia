-- ============================================================
-- Migration: 20260226010000_audit_log.sql
-- Audit log table: multi-tenant, immutable, no PII.
-- Idempotent: safe to re-run.
-- ============================================================

-- ── 1. Table ──────────────────────────────────────────────────────────────────

create table if not exists public.audit_logs (
  id          bigserial    primary key,
  created_at  timestamptz  not null default now(),
  biz_id      uuid         not null,
  user_id     uuid         null,
  request_id  text         null,
  action      text         not null,
  resource    text         not null,
  resource_id text         null,
  result      text         not null check (result in ('success', 'failure', 'denied')),
  details     jsonb        null
);

-- ── 2. Indexes ────────────────────────────────────────────────────────────────

create index if not exists audit_logs_biz_created_idx
  on public.audit_logs (biz_id, created_at desc);

create index if not exists audit_logs_action_created_idx
  on public.audit_logs (action, created_at desc);

-- ── 3. Enable RLS ─────────────────────────────────────────────────────────────

alter table public.audit_logs enable row level security;

-- ── 4. RLS Policies ───────────────────────────────────────────────────────────

-- SELECT: biz members can read logs for their own businesses.
drop policy if exists "audit_logs_biz_select" on public.audit_logs;
create policy "audit_logs_biz_select"
  on public.audit_logs for select
  using (biz_id in (select public.user_biz_ids()));

-- INSERT: no permissive policy for authenticated/anon roles.
-- service_role bypasses RLS and can insert freely via getAdminClient().

-- UPDATE: deny all (immutability layer 1).
drop policy if exists "audit_logs_deny_update" on public.audit_logs;
create policy "audit_logs_deny_update"
  on public.audit_logs for update
  using (false)
  with check (false);

-- DELETE: deny all (immutability layer 1).
-- service_role bypasses RLS; cleanup is allowed by the trigger (layer 2).
drop policy if exists "audit_logs_deny_delete" on public.audit_logs;
create policy "audit_logs_deny_delete"
  on public.audit_logs for delete
  using (false);

-- ── 5. Immutability trigger (layer 2) ─────────────────────────────────────────
--
-- Blocks UPDATE for ALL roles (including service_role) — audits are never edited.
-- Allows DELETE only for service_role (the retention-cleanup cron uses it).
-- Blocks DELETE for every other role.

create or replace function public.audit_logs_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Retention cleanup via CRON_SECRET-protected endpoint uses service_role.
  -- Allow DELETE for service_role only; block everything else.
  if TG_OP = 'DELETE' and current_user = 'service_role' then
    return old;
  end if;
  raise exception 'AUDIT_IMMUTABLE: audit_logs rows cannot be modified or deleted';
end;
$$;

drop trigger if exists audit_logs_immutable_tg on public.audit_logs;
create trigger audit_logs_immutable_tg
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- ── 6. PostgREST schema reload ────────────────────────────────────────────────

notify pgrst, 'reload schema';
