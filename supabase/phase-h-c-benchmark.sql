-- ============================================================
-- OpinIA Phase H-C — Competitors + Missions
-- ============================================================

-- Competitors (manual opt-in)
create table if not exists public.competitors (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  biz_id        uuid not null references public.businesses(id) on delete cascade,
  name          text not null,
  place_id      text,
  public_url    text,
  avg_rating    numeric(2,1),
  review_count  int,
  is_active     boolean not null default true,
  last_updated  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_comp_biz
  on public.competitors (biz_id, is_active);

create trigger trg_competitors_updated_at
  before update on public.competitors
  for each row execute function public.trg_set_updated_at();

alter table public.competitors enable row level security;

create policy "comp_select" on public.competitors
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

create policy "comp_insert" on public.competitors
  for insert to authenticated
  with check (org_id in (select public.user_org_ids()));

create policy "comp_update" on public.competitors
  for update to authenticated
  using (org_id in (select public.user_org_ids()));

create policy "comp_delete" on public.competitors
  for delete to authenticated
  using (org_id in (select public.user_org_ids()));

-- Missions / Achievements
create table if not exists public.missions (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  biz_id        uuid not null references public.businesses(id) on delete cascade,
  mission_key   text not null,
  progress      int not null default 0,
  target        int not null default 1,
  completed_at  timestamptz,
  period_start  date not null default current_date,
  created_at    timestamptz not null default now(),
  unique (biz_id, mission_key, period_start)
);

create index if not exists idx_missions_biz
  on public.missions (biz_id, period_start desc);

alter table public.missions enable row level security;

create policy "missions_select" on public.missions
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

-- service_role writes

comment on table public.competitors is 'Manual opt-in competitor tracking for benchmarking.';
comment on table public.missions is 'Gamification missions with weekly progress tracking.';
