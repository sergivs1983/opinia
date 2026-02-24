-- ============================================================
-- OpinIA Phase H-A — Audit Runs (lead magnet tracking)
-- Run AFTER schema-v2-extensions.sql
-- ============================================================

create table if not exists public.audit_runs (
  id              uuid primary key default uuid_generate_v4(),
  -- nullable: anonymous users (pre-login) won't have org/biz
  org_id          uuid references public.organizations(id) on delete set null,
  biz_id          uuid references public.businesses(id) on delete set null,
  user_id         uuid references auth.users(id) on delete set null,
  -- input
  input_type      text not null default 'manual'
                    check (input_type in ('manual', 'url')),
  input_url       text,
  review_count    int not null default 0,
  -- results
  result          jsonb not null default '{}'::jsonb,
  -- lead tracking
  email           text,
  ip_hash         text,
  user_agent      text,
  converted       boolean not null default false,
  -- timestamps
  created_at      timestamptz not null default now()
);

create index if not exists idx_ar_created
  on public.audit_runs (created_at desc);

create index if not exists idx_ar_email
  on public.audit_runs (email)
  where email is not null;

create index if not exists idx_ar_org
  on public.audit_runs (org_id, created_at desc)
  where org_id is not null;

-- RLS: authenticated users see their org's runs; anon inserts allowed (public demo)
alter table public.audit_runs enable row level security;

-- Authenticated users can read their org's audit runs
create policy "ar_select_org" on public.audit_runs
  for select to authenticated
  using (
    org_id is null
    or org_id in (select public.user_org_ids())
  );

-- Anyone can insert (public demo endpoint writes via service_role anyway)
-- Service role bypasses RLS, so no insert policy needed for anon

comment on table public.audit_runs is
  'Tracks public demo audit runs for lead magnet / conversion funnel.';
