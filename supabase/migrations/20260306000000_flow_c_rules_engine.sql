-- Flow C (LITO Rules Engine) — MVP schema
-- Safe / idempotent migration

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'rule_status') then
    create type public.rule_status as enum ('active', 'disabled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rule_action_type') then
    create type public.rule_action_type as enum ('require_approval', 'draft', 'auto_publish_template');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rule_run_status') then
    create type public.rule_run_status as enum ('queued', 'processing', 'done', 'skipped', 'failed');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rule_condition_op') then
    create type public.rule_condition_op as enum ('eq', 'neq', 'in', 'contains', 'gte', 'lte', 'exists');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.rules (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid null references public.businesses(id) on delete cascade,
  provider public.integration_provider null,
  name text not null,
  status public.rule_status not null default 'active',
  priority integer not null default 100,
  allow_auto_publish boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rule_conditions (
  id uuid primary key default uuid_generate_v4(),
  rule_id uuid not null references public.rules(id) on delete cascade,
  field text not null,
  op public.rule_condition_op not null,
  value jsonb null,
  created_at timestamptz not null default now()
);

create table if not exists public.rule_actions (
  id uuid primary key default uuid_generate_v4(),
  rule_id uuid not null references public.rules(id) on delete cascade,
  type public.rule_action_type not null,
  template text null,
  template_version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.rule_runs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  provider public.integration_provider not null default 'google_business',
  review_id text not null,
  status public.rule_run_status not null default 'queued',
  triage jsonb null,
  matched_rule_id uuid null references public.rules(id) on delete set null,
  matched_action_id uuid null references public.rule_actions(id) on delete set null,
  decision jsonb null,
  publish_job_id uuid null references public.publish_jobs(id) on delete set null,
  error jsonb null,
  attempts integer not null default 0,
  locked_at timestamptz null,
  locked_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_rules_match
  on public.rules (org_id, biz_id, provider, status, priority);

create index if not exists idx_rule_conditions_rule_id
  on public.rule_conditions (rule_id);

create index if not exists idx_rule_actions_rule_id
  on public.rule_actions (rule_id);

create index if not exists idx_rule_runs_status_lock
  on public.rule_runs (status, locked_at);

create index if not exists idx_rule_runs_scope
  on public.rule_runs (org_id, biz_id, provider);

create unique index if not exists ux_rule_runs_done_idempotency
  on public.rule_runs (org_id, biz_id, provider, review_id, matched_action_id)
  where status = 'done' and matched_action_id is not null;

create unique index if not exists ux_rule_runs_one_active_per_review
  on public.rule_runs (org_id, biz_id, provider, review_id)
  where status in ('queued', 'processing');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.rules enable row level security;
alter table public.rule_conditions enable row level security;
alter table public.rule_actions enable row level security;
alter table public.rule_runs enable row level security;

drop policy if exists "rules_select_org_members" on public.rules;
create policy "rules_select_org_members"
  on public.rules
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.org_id = rules.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "rules_deny_write_authenticated" on public.rules;
create policy "rules_deny_write_authenticated"
  on public.rules
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "rule_conditions_select_org_members" on public.rule_conditions;
create policy "rule_conditions_select_org_members"
  on public.rule_conditions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.rules r
      join public.memberships m on m.org_id = r.org_id
      where r.id = rule_conditions.rule_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "rule_conditions_deny_write_authenticated" on public.rule_conditions;
create policy "rule_conditions_deny_write_authenticated"
  on public.rule_conditions
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "rule_actions_select_org_members" on public.rule_actions;
create policy "rule_actions_select_org_members"
  on public.rule_actions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.rules r
      join public.memberships m on m.org_id = r.org_id
      where r.id = rule_actions.rule_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "rule_actions_deny_write_authenticated" on public.rule_actions;
create policy "rule_actions_deny_write_authenticated"
  on public.rule_actions
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "rule_runs_select_org_members" on public.rule_runs;
create policy "rule_runs_select_org_members"
  on public.rule_runs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.org_id = rule_runs.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "rule_runs_deny_write_authenticated" on public.rule_runs;
create policy "rule_runs_deny_write_authenticated"
  on public.rule_runs
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "rules_service_role_all" on public.rules;
create policy "rules_service_role_all"
  on public.rules
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "rule_conditions_service_role_all" on public.rule_conditions;
create policy "rule_conditions_service_role_all"
  on public.rule_conditions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "rule_actions_service_role_all" on public.rule_actions;
create policy "rule_actions_service_role_all"
  on public.rule_actions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "rule_runs_service_role_all" on public.rule_runs;
create policy "rule_runs_service_role_all"
  on public.rule_runs
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- RPC to atomically claim queued rule runs (single query + SKIP LOCKED)
-- ---------------------------------------------------------------------------
create or replace function public.pop_rule_runs(
  p_limit integer default 25,
  p_worker text default null
)
returns setof public.rule_runs
language sql
security definer
set search_path = public
as $$
  with claim as (
    select rr.id
    from public.rule_runs rr
    where rr.status = 'queued'
      and (rr.locked_at is null or rr.locked_at < now() - interval '5 minutes')
    order by rr.created_at asc
    limit greatest(coalesce(p_limit, 25), 1)
    for update skip locked
  )
  update public.rule_runs rr
  set
    status = 'processing',
    locked_at = now(),
    locked_by = coalesce(p_worker, 'rules-worker'),
    attempts = rr.attempts + 1,
    updated_at = now()
  from claim
  where rr.id = claim.id
  returning rr.*;
$$;

revoke all on function public.pop_rule_runs(integer, text) from public;
revoke all on function public.pop_rule_runs(integer, text) from anon;
revoke all on function public.pop_rule_runs(integer, text) from authenticated;
grant execute on function public.pop_rule_runs(integer, text) to service_role;

notify pgrst, 'reload schema';
