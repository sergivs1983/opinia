-- ============================================================
-- OpinIA Phase A — LLM Usage Events (cost tracking)
-- ============================================================

create table if not exists public.llm_usage_events (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  biz_id            uuid not null references public.businesses(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  request_id        text not null,
  feature           text not null,
  provider          text not null,
  model             text not null,
  prompt_tokens     int not null default 0,
  completion_tokens int not null default 0,
  total_tokens      int not null default 0,
  cost_usd          numeric(10, 6) not null default 0,
  duration_ms       int not null default 0,
  status            text not null default 'success'
                      check (status in ('success', 'error')),
  error_code        text,
  created_at        timestamptz not null default now()
);

-- Main query pattern: "show me cost for org X this month"
create index if not exists idx_lue_org_month
  on public.llm_usage_events (org_id, created_at desc);

-- Feature breakdown: "how much does classify vs generate cost?"
create index if not exists idx_lue_feature
  on public.llm_usage_events (org_id, feature, created_at desc);

-- Per-business drill-down
create index if not exists idx_lue_biz
  on public.llm_usage_events (biz_id, created_at desc);

-- Cost aggregation (skip errors in cost sums)
create index if not exists idx_lue_cost_agg
  on public.llm_usage_events (org_id, created_at)
  where status = 'success';

-- RLS
alter table public.llm_usage_events enable row level security;

create policy "lue_select_org" on public.llm_usage_events
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

-- service_role writes (bypasses RLS automatically)

comment on table public.llm_usage_events is
  'Per-request LLM cost tracking: tokens, cost_usd, feature attribution. Written by service_role.';
