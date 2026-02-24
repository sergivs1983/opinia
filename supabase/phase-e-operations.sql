-- ============================================================
-- OpinIA Phase E — Operations Dashboard
-- Run AFTER phase-d-production.sql
-- Adds: ops_actions (NO modifications to existing tables)
-- ============================================================

create table if not exists public.ops_actions (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  biz_id          uuid not null references public.businesses(id) on delete cascade,
  theme           text not null,          -- topic taxonomy: noise, cleanliness, staff...
  title           text not null,
  recommendation  text,
  status          text not null default 'open',   -- open, in_progress, done
  priority        text not null default 'medium', -- low, medium, high
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  done_at         timestamptz
);

create index if not exists idx_ops_actions_biz
  on public.ops_actions(biz_id, status);

create index if not exists idx_ops_actions_theme
  on public.ops_actions(biz_id, theme);

create index if not exists idx_ops_actions_org
  on public.ops_actions(org_id);

-- Trigger
create trigger trg_ops_actions_updated_at
  before update on public.ops_actions
  for each row execute function public.trg_set_updated_at();

-- RLS
alter table public.ops_actions enable row level security;

create policy "ops_actions_select" on public.ops_actions
  for select using (org_id in (select public.user_org_ids()));

create policy "ops_actions_insert" on public.ops_actions
  for insert with check (org_id in (select public.user_org_ids()));

create policy "ops_actions_update" on public.ops_actions
  for update using (org_id in (select public.user_org_ids()));

create policy "ops_actions_delete" on public.ops_actions
  for delete using (org_id in (select public.user_org_ids()));
