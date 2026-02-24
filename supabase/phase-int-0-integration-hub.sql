-- ============================================================
-- OpinIA INT-0 — Integration Hub Foundation
-- Events + Connectors + Deliveries
-- ============================================================

-- ------------------------------------------------------------
-- 1) connectors
-- ------------------------------------------------------------
create table if not exists public.connectors (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  type             text not null check (type in ('webhook')),
  enabled          boolean not null default false,
  url              text null,
  secret           text null,
  allowed_channels text[] not null default '{}'::text[],
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists idx_connectors_business_type_unique
  on public.connectors (business_id, type);

create index if not exists idx_connectors_business_created_desc
  on public.connectors (business_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'connectors_allowed_channels_ck'
  ) then
    alter table public.connectors
      add constraint connectors_allowed_channels_ck
      check (
        allowed_channels <@ array['ig_feed', 'ig_story', 'ig_reel', 'x', 'threads']::text[]
      );
  end if;
end $$;

drop trigger if exists trg_connectors_updated_at on public.connectors;
create trigger trg_connectors_updated_at
  before update on public.connectors
  for each row execute function public.trg_set_updated_at();

alter table public.connectors enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connectors'
      and policyname = 'connectors_select'
  ) then
    create policy "connectors_select" on public.connectors
      for select using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connectors'
      and policyname = 'connectors_insert'
  ) then
    create policy "connectors_insert" on public.connectors
      for insert with check (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connectors'
      and policyname = 'connectors_update'
  ) then
    create policy "connectors_update" on public.connectors
      for update using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connectors'
      and policyname = 'connectors_delete'
  ) then
    create policy "connectors_delete" on public.connectors
      for delete using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) webhook_deliveries evolution
-- ------------------------------------------------------------
alter table public.webhook_deliveries
  add column if not exists connector_id uuid null references public.connectors(id) on delete set null;

alter table public.webhook_deliveries
  alter column event set not null;

alter table public.webhook_deliveries
  alter column status set not null;

alter table public.webhook_deliveries
  alter column created_at set default now();

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'webhook_deliveries_event_check'
  ) then
    alter table public.webhook_deliveries drop constraint webhook_deliveries_event_check;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'webhook_deliveries_event_ck'
  ) then
    alter table public.webhook_deliveries drop constraint webhook_deliveries_event_ck;
  end if;
end $$;

do $$
begin
  alter table public.webhook_deliveries
    add constraint webhook_deliveries_event_ck
    check (
      event in (
        'planner.ready',
        'planner.published',
        'reply.approved',
        'asset.created',
        'export.created'
      )
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'webhook_deliveries_status_check'
  ) then
    alter table public.webhook_deliveries drop constraint webhook_deliveries_status_check;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'webhook_deliveries_status_ck'
  ) then
    alter table public.webhook_deliveries drop constraint webhook_deliveries_status_ck;
  end if;
end $$;

do $$
begin
  alter table public.webhook_deliveries
    add constraint webhook_deliveries_status_ck
    check (status in ('sent', 'failed'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_webhook_deliveries_business_created_desc
  on public.webhook_deliveries (business_id, created_at desc);

create index if not exists idx_webhook_deliveries_connector_event_created_desc
  on public.webhook_deliveries (connector_id, event, created_at desc);

-- ------------------------------------------------------------
-- 3) Compatibility migration from businesses.* webhook config
-- ------------------------------------------------------------
insert into public.connectors (
  business_id,
  type,
  enabled,
  url,
  secret,
  allowed_channels
)
select
  b.id as business_id,
  'webhook' as type,
  coalesce(b.webhook_enabled, false) as enabled,
  b.webhook_url as url,
  b.webhook_secret as secret,
  coalesce(b.webhook_channels, '{}'::text[]) as allowed_channels
from public.businesses b
where coalesce(b.webhook_enabled, false) = true
  and b.webhook_url is not null
  and not exists (
    select 1
    from public.connectors c
    where c.business_id = b.id
      and c.type = 'webhook'
  );

notify pgrst, 'reload schema';

