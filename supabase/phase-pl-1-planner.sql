-- ============================================================
-- OpinIA PL-1 — Persistent weekly planner
-- Idempotent migration.
-- ============================================================

-- ------------------------------------------------------------
-- 1) content_planner_items
-- ------------------------------------------------------------
create table if not exists public.content_planner_items (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  week_start    date not null,
  scheduled_at  timestamptz not null,
  channel       text not null check (channel in ('ig_story', 'ig_feed', 'ig_reel', 'x', 'threads')),
  item_type     text not null check (item_type in ('suggestion', 'asset', 'text')),
  suggestion_id uuid references public.content_suggestions(id) on delete set null,
  asset_id      uuid references public.content_assets(id) on delete set null,
  text_post_id  uuid references public.content_text_posts(id) on delete set null,
  title         text not null,
  notes         text null,
  status        text not null default 'planned' check (status in ('planned', 'published')),
  created_at    timestamptz not null default now(),
  constraint content_planner_items_week_start_monday_ck check (extract(isodow from week_start) = 1),
  constraint content_planner_items_type_ref_ck check (
    (item_type = 'suggestion' and suggestion_id is not null and asset_id is null and text_post_id is null)
    or (item_type = 'asset' and asset_id is not null and suggestion_id is null and text_post_id is null)
    or (item_type = 'text' and text_post_id is not null and suggestion_id is null and asset_id is null)
  )
);

-- Backfill/alter for partially existing tables.
alter table public.content_planner_items add column if not exists business_id uuid;
alter table public.content_planner_items add column if not exists week_start date;
alter table public.content_planner_items add column if not exists scheduled_at timestamptz;
alter table public.content_planner_items add column if not exists channel text;
alter table public.content_planner_items add column if not exists item_type text;
alter table public.content_planner_items add column if not exists suggestion_id uuid;
alter table public.content_planner_items add column if not exists asset_id uuid;
alter table public.content_planner_items add column if not exists text_post_id uuid;
alter table public.content_planner_items add column if not exists title text;
alter table public.content_planner_items add column if not exists notes text;
alter table public.content_planner_items add column if not exists status text;
alter table public.content_planner_items add column if not exists created_at timestamptz default now();

alter table public.content_planner_items
  alter column status set default 'planned';
alter table public.content_planner_items
  alter column created_at set default now();

update public.content_planner_items
set status = 'planned'
where status is null or status = '';

update public.content_planner_items
set notes = null
where notes = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'content_planner_items_business_fk'
  ) then
    alter table public.content_planner_items
      add constraint content_planner_items_business_fk
      foreign key (business_id) references public.businesses(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'content_planner_items_suggestion_fk'
  ) then
    alter table public.content_planner_items
      add constraint content_planner_items_suggestion_fk
      foreign key (suggestion_id) references public.content_suggestions(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'content_planner_items_asset_fk'
  ) then
    alter table public.content_planner_items
      add constraint content_planner_items_asset_fk
      foreign key (asset_id) references public.content_assets(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'content_planner_items_text_post_fk'
  ) then
    alter table public.content_planner_items
      add constraint content_planner_items_text_post_fk
      foreign key (text_post_id) references public.content_text_posts(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'content_planner_items_channel_ck'
  ) then
    alter table public.content_planner_items
      add constraint content_planner_items_channel_ck
      check (channel in ('ig_story', 'ig_feed', 'ig_reel', 'x', 'threads'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'content_planner_items_item_type_ck'
  ) then
    alter table public.content_planner_items
      add constraint content_planner_items_item_type_ck
      check (item_type in ('suggestion', 'asset', 'text'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'content_planner_items_status_ck'
  ) then
    alter table public.content_planner_items
      add constraint content_planner_items_status_ck
      check (status in ('planned', 'published'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'content_planner_items_week_start_monday_ck'
  ) then
    alter table public.content_planner_items
      add constraint content_planner_items_week_start_monday_ck
      check (extract(isodow from week_start) = 1);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'content_planner_items_type_ref_ck'
  ) then
    alter table public.content_planner_items
      add constraint content_planner_items_type_ref_ck
      check (
        (item_type = 'suggestion' and suggestion_id is not null and asset_id is null and text_post_id is null)
        or (item_type = 'asset' and asset_id is not null and suggestion_id is null and text_post_id is null)
        or (item_type = 'text' and text_post_id is not null and suggestion_id is null and asset_id is null)
      );
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) Indexes
-- ------------------------------------------------------------
create index if not exists idx_content_planner_items_business_week
  on public.content_planner_items (business_id, week_start);

create index if not exists idx_content_planner_items_business_scheduled_desc
  on public.content_planner_items (business_id, scheduled_at desc);

-- ------------------------------------------------------------
-- 3) RLS
-- ------------------------------------------------------------
alter table public.content_planner_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'content_planner_items' and policyname = 'content_planner_items_select'
  ) then
    create policy "content_planner_items_select" on public.content_planner_items
      for select using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'content_planner_items' and policyname = 'content_planner_items_insert'
  ) then
    create policy "content_planner_items_insert" on public.content_planner_items
      for insert with check (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'content_planner_items' and policyname = 'content_planner_items_update'
  ) then
    create policy "content_planner_items_update" on public.content_planner_items
      for update using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'content_planner_items' and policyname = 'content_planner_items_delete'
  ) then
    create policy "content_planner_items_delete" on public.content_planner_items
      for delete using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

notify pgrst, 'reload schema';
