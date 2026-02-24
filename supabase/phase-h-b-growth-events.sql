-- ============================================================
-- OpinIA Phase H-B — Growth Events (click/scan tracking)
-- growth_links already exists in schema-v2-extensions.sql
-- This adds the events tracking table + type column to growth_links
-- ============================================================

-- Add type column to growth_links if not exists
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'growth_links' and column_name = 'type'
  ) then
    alter table public.growth_links add column type text not null default 'qr_review';
  end if;
end $$;

-- Growth events (click/scan tracking)
create table if not exists public.growth_events (
  id            uuid primary key default uuid_generate_v4(),
  link_id       uuid not null references public.growth_links(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  biz_id        uuid not null references public.businesses(id) on delete cascade,
  event_type    text not null default 'click'
                  check (event_type in ('click', 'scan')),
  ip_hash       text,
  user_agent    text,
  referer       text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_ge_link
  on public.growth_events (link_id, created_at desc);

create index if not exists idx_ge_biz_week
  on public.growth_events (biz_id, created_at desc);

create index if not exists idx_ge_org
  on public.growth_events (org_id, created_at desc);

-- RLS
alter table public.growth_events enable row level security;

create policy "ge_select_org" on public.growth_events
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

-- service_role writes (redirect endpoint)

comment on table public.growth_events is
  'Click/scan tracking for growth links (QR codes, short links).';
