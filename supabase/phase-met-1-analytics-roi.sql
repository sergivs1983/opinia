-- ============================================================
-- OpinIA MET-1 — Analytics / ROI dashboard
-- Idempotent migration.
-- ============================================================

-- ------------------------------------------------------------
-- 1) metrics_daily (daily aggregate counters per business)
-- ------------------------------------------------------------
create table if not exists public.metrics_daily (
  business_id             uuid not null references public.businesses(id) on delete cascade,
  day                     date not null,
  reviews_received        int not null default 0,
  replies_generated       int not null default 0,
  replies_approved        int not null default 0,
  planner_items_added     int not null default 0,
  planner_items_published int not null default 0,
  assets_created          int not null default 0,
  exports_created         int not null default 0,
  ai_cost_cents           int not null default 0,
  ai_tokens_in            int not null default 0,
  ai_tokens_out           int not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  primary key (business_id, day)
);

-- Backfill/alter for partially existing tables.
alter table public.metrics_daily add column if not exists business_id uuid;
alter table public.metrics_daily add column if not exists day date;
alter table public.metrics_daily add column if not exists reviews_received int;
alter table public.metrics_daily add column if not exists replies_generated int;
alter table public.metrics_daily add column if not exists replies_approved int;
alter table public.metrics_daily add column if not exists planner_items_added int;
alter table public.metrics_daily add column if not exists planner_items_published int;
alter table public.metrics_daily add column if not exists assets_created int;
alter table public.metrics_daily add column if not exists exports_created int;
alter table public.metrics_daily add column if not exists ai_cost_cents int;
alter table public.metrics_daily add column if not exists ai_tokens_in int;
alter table public.metrics_daily add column if not exists ai_tokens_out int;
alter table public.metrics_daily add column if not exists created_at timestamptz default now();
alter table public.metrics_daily add column if not exists updated_at timestamptz default now();

update public.metrics_daily set reviews_received = 0 where reviews_received is null;
update public.metrics_daily set replies_generated = 0 where replies_generated is null;
update public.metrics_daily set replies_approved = 0 where replies_approved is null;
update public.metrics_daily set planner_items_added = 0 where planner_items_added is null;
update public.metrics_daily set planner_items_published = 0 where planner_items_published is null;
update public.metrics_daily set assets_created = 0 where assets_created is null;
update public.metrics_daily set exports_created = 0 where exports_created is null;
update public.metrics_daily set ai_cost_cents = 0 where ai_cost_cents is null;
update public.metrics_daily set ai_tokens_in = 0 where ai_tokens_in is null;
update public.metrics_daily set ai_tokens_out = 0 where ai_tokens_out is null;
update public.metrics_daily set created_at = now() where created_at is null;
update public.metrics_daily set updated_at = now() where updated_at is null;

alter table public.metrics_daily alter column reviews_received set default 0;
alter table public.metrics_daily alter column replies_generated set default 0;
alter table public.metrics_daily alter column replies_approved set default 0;
alter table public.metrics_daily alter column planner_items_added set default 0;
alter table public.metrics_daily alter column planner_items_published set default 0;
alter table public.metrics_daily alter column assets_created set default 0;
alter table public.metrics_daily alter column exports_created set default 0;
alter table public.metrics_daily alter column ai_cost_cents set default 0;
alter table public.metrics_daily alter column ai_tokens_in set default 0;
alter table public.metrics_daily alter column ai_tokens_out set default 0;
alter table public.metrics_daily alter column created_at set default now();
alter table public.metrics_daily alter column updated_at set default now();

alter table public.metrics_daily alter column business_id set not null;
alter table public.metrics_daily alter column day set not null;
alter table public.metrics_daily alter column reviews_received set not null;
alter table public.metrics_daily alter column replies_generated set not null;
alter table public.metrics_daily alter column replies_approved set not null;
alter table public.metrics_daily alter column planner_items_added set not null;
alter table public.metrics_daily alter column planner_items_published set not null;
alter table public.metrics_daily alter column assets_created set not null;
alter table public.metrics_daily alter column exports_created set not null;
alter table public.metrics_daily alter column ai_cost_cents set not null;
alter table public.metrics_daily alter column ai_tokens_in set not null;
alter table public.metrics_daily alter column ai_tokens_out set not null;
alter table public.metrics_daily alter column created_at set not null;
alter table public.metrics_daily alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'metrics_daily_business_fk'
  ) then
    alter table public.metrics_daily
      add constraint metrics_daily_business_fk
      foreign key (business_id) references public.businesses(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'metrics_daily_business_day_key'
  ) then
    alter table public.metrics_daily
      add constraint metrics_daily_business_day_key
      unique (business_id, day);
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) Indexes
-- ------------------------------------------------------------
create index if not exists idx_metrics_daily_business_day_desc
  on public.metrics_daily (business_id, day desc);

-- ------------------------------------------------------------
-- 3) Trigger (updated_at)
-- ------------------------------------------------------------
drop trigger if exists trg_metrics_daily_updated_at on public.metrics_daily;
create trigger trg_metrics_daily_updated_at
  before update on public.metrics_daily
  for each row execute function public.trg_set_updated_at();

-- ------------------------------------------------------------
-- 4) RLS
-- ------------------------------------------------------------
alter table public.metrics_daily enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'metrics_daily' and policyname = 'metrics_daily_select'
  ) then
    create policy "metrics_daily_select" on public.metrics_daily
      for select using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'metrics_daily' and policyname = 'metrics_daily_insert'
  ) then
    create policy "metrics_daily_insert" on public.metrics_daily
      for insert with check (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'metrics_daily' and policyname = 'metrics_daily_update'
  ) then
    create policy "metrics_daily_update" on public.metrics_daily
      for update using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'metrics_daily' and policyname = 'metrics_daily_delete'
  ) then
    create policy "metrics_daily_delete" on public.metrics_daily
      for delete using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

notify pgrst, 'reload schema';
