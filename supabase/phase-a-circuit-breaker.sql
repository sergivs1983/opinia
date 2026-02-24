-- ============================================================
-- OpinIA Phase A — Circuit Breakers (serverless-safe)
-- Run AFTER schema-v2-extensions.sql (needs trg_set_updated_at)
-- ============================================================

create table if not exists public.circuit_breakers (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid references public.organizations(id) on delete cascade,
  provider        text not null,
  model           text not null,
  state           text not null default 'closed'
                    check (state in ('closed', 'open', 'half_open')),
  failure_count   int not null default 0,
  last_failure_at timestamptz,
  open_until      timestamptz,
  updated_at      timestamptz not null default now()
);

-- Unique constraints: need TWO partial indexes because
-- PostgreSQL UNIQUE treats NULL != NULL, so unique(org_id, provider, model)
-- allows duplicate (NULL, 'openai', 'gpt-4o') rows.
create unique index if not exists idx_cb_org_provider_model
  on public.circuit_breakers (org_id, provider, model)
  where org_id is not null;

create unique index if not exists idx_cb_global_provider_model
  on public.circuit_breakers (provider, model)
  where org_id is null;

create index if not exists idx_cb_lookup
  on public.circuit_breakers (provider, model, state);

-- Auto updated_at
create trigger trg_cb_updated_at
  before update on public.circuit_breakers
  for each row execute function public.trg_set_updated_at();

-- RLS
alter table public.circuit_breakers enable row level security;

-- Authenticated users can read global + their org circuits
create policy "cb_select_auth" on public.circuit_breakers
  for select to authenticated using (
    org_id is null
    or org_id in (select public.user_org_ids())
  );

-- Only service_role can write (admin client)
-- service_role bypasses RLS by default, no policy needed

comment on table public.circuit_breakers is
  'Circuit breaker state per (provider, model, org_id?). Serverless-safe persistence. Written by service_role only.';

-- ============================================================
-- Atomic upsert function to avoid race conditions
-- Uses advisory lock on hash of (provider, model) to serialize
-- ============================================================
create or replace function public.cb_upsert(
  p_org_id uuid,
  p_provider text,
  p_model text,
  p_state text,
  p_failure_count int,
  p_last_failure_at timestamptz,
  p_open_until timestamptz
) returns void
language plpgsql security definer as $$
declare
  lock_key bigint;
begin
  -- Advisory lock based on hash of provider+model (plus org_id if set)
  lock_key := hashtext(coalesce(p_org_id::text, 'GLOBAL') || ':' || p_provider || ':' || p_model);
  perform pg_advisory_xact_lock(lock_key);

  if p_org_id is null then
    insert into public.circuit_breakers (org_id, provider, model, state, failure_count, last_failure_at, open_until, updated_at)
    values (null, p_provider, p_model, p_state, p_failure_count, p_last_failure_at, p_open_until, now())
    on conflict (provider, model) where org_id is null
    do update set
      state = excluded.state,
      failure_count = excluded.failure_count,
      last_failure_at = excluded.last_failure_at,
      open_until = excluded.open_until,
      updated_at = now();
  else
    insert into public.circuit_breakers (org_id, provider, model, state, failure_count, last_failure_at, open_until, updated_at)
    values (p_org_id, p_provider, p_model, p_state, p_failure_count, p_last_failure_at, p_open_until, now())
    on conflict (org_id, provider, model) where org_id is not null
    do update set
      state = excluded.state,
      failure_count = excluded.failure_count,
      last_failure_at = excluded.last_failure_at,
      open_until = excluded.open_until,
      updated_at = now();
  end if;
end;
$$;
