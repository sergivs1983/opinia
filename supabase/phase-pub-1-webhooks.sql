-- ============================================================
-- OpinIA PUB-1 — Planner webhook connector (Zapier/Make)
-- ============================================================

-- ------------------------------------------------------------
-- 1) businesses webhook config columns
-- ------------------------------------------------------------
alter table public.businesses add column if not exists webhook_enabled boolean;
alter table public.businesses add column if not exists webhook_url text;
alter table public.businesses add column if not exists webhook_secret text;
alter table public.businesses add column if not exists webhook_channels text[];

update public.businesses
set webhook_enabled = false
where webhook_enabled is null;

update public.businesses
set webhook_channels = '{}'::text[]
where webhook_channels is null;

alter table public.businesses
  alter column webhook_enabled set default false;

alter table public.businesses
  alter column webhook_channels set default '{}'::text[];

alter table public.businesses
  alter column webhook_enabled set not null;

alter table public.businesses
  alter column webhook_channels set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_webhook_channels_ck'
  ) then
    alter table public.businesses
      add constraint businesses_webhook_channels_ck
      check (
        webhook_channels <@ array['ig_story', 'ig_feed', 'ig_reel', 'x', 'threads']::text[]
      );
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) webhook_deliveries
-- ------------------------------------------------------------
create table if not exists public.webhook_deliveries (
  id             uuid primary key default uuid_generate_v4(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  planner_item_id uuid null references public.content_planner_items(id) on delete set null,
  event          text not null check (event in ('planner.ready', 'planner.published')),
  status         text not null check (status in ('sent', 'failed')),
  response_code  int null,
  error          text null,
  request_id     text null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_webhook_deliveries_business_created_desc
  on public.webhook_deliveries (business_id, created_at desc);

alter table public.webhook_deliveries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'webhook_deliveries'
      and policyname = 'webhook_deliveries_select'
  ) then
    create policy "webhook_deliveries_select" on public.webhook_deliveries
      for select using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'webhook_deliveries'
      and policyname = 'webhook_deliveries_insert'
  ) then
    create policy "webhook_deliveries_insert" on public.webhook_deliveries
      for insert with check (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'webhook_deliveries'
      and policyname = 'webhook_deliveries_update'
  ) then
    create policy "webhook_deliveries_update" on public.webhook_deliveries
      for update using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'webhook_deliveries'
      and policyname = 'webhook_deliveries_delete'
  ) then
    create policy "webhook_deliveries_delete" on public.webhook_deliveries
      for delete using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

notify pgrst, 'reload schema';
