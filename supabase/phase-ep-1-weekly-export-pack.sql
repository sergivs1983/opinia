-- ============================================================
-- OpinIA EP-1 — Weekly Export Pack (ZIP)
-- Idempotent migration.
-- ============================================================

-- ------------------------------------------------------------
-- 0) Private bucket for export ZIP files
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do update set public = excluded.public;

-- ------------------------------------------------------------
-- 1) exports table
-- ------------------------------------------------------------
create table if not exists public.exports (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  week_start     date not null,
  language       text not null check (language in ('ca', 'es', 'en')),
  kind           text not null default 'weekly_pack' check (kind in ('weekly_pack')),
  storage_bucket text not null default 'exports',
  storage_path   text not null unique,
  bytes          int not null,
  items_count    int not null default 0,
  status         text not null default 'ready' check (status in ('ready', 'failed')),
  created_at     timestamptz not null default now()
);

-- Backfill/alter in case a partial table exists.
alter table public.exports add column if not exists business_id uuid;
alter table public.exports add column if not exists week_start date;
alter table public.exports add column if not exists language text;
alter table public.exports add column if not exists kind text;
alter table public.exports add column if not exists storage_bucket text;
alter table public.exports add column if not exists storage_path text;
alter table public.exports add column if not exists bytes int;
alter table public.exports add column if not exists items_count int;
alter table public.exports add column if not exists status text;
alter table public.exports add column if not exists created_at timestamptz default now();

update public.exports set kind = 'weekly_pack' where kind is null or kind = '';
update public.exports set storage_bucket = 'exports' where storage_bucket is null or storage_bucket = '';
update public.exports set items_count = 0 where items_count is null;
update public.exports set status = 'ready' where status is null or status = '';

alter table public.exports alter column kind set default 'weekly_pack';
alter table public.exports alter column storage_bucket set default 'exports';
alter table public.exports alter column items_count set default 0;
alter table public.exports alter column status set default 'ready';
alter table public.exports alter column created_at set default now();

alter table public.exports alter column business_id set not null;
alter table public.exports alter column week_start set not null;
alter table public.exports alter column language set not null;
alter table public.exports alter column kind set not null;
alter table public.exports alter column storage_bucket set not null;
alter table public.exports alter column storage_path set not null;
alter table public.exports alter column bytes set not null;
alter table public.exports alter column items_count set not null;
alter table public.exports alter column status set not null;
alter table public.exports alter column created_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exports_business_fk'
  ) then
    alter table public.exports
      add constraint exports_business_fk
      foreign key (business_id) references public.businesses(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'exports_language_ck'
  ) then
    alter table public.exports
      add constraint exports_language_ck
      check (language in ('ca', 'es', 'en'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'exports_kind_ck'
  ) then
    alter table public.exports
      add constraint exports_kind_ck
      check (kind in ('weekly_pack'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'exports_status_ck'
  ) then
    alter table public.exports
      add constraint exports_status_ck
      check (status in ('ready', 'failed'));
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) Indexes
-- ------------------------------------------------------------
create unique index if not exists ux_exports_business_week_language_kind
  on public.exports (business_id, week_start, language, kind);

create index if not exists idx_exports_business_created
  on public.exports (business_id, created_at desc);

-- ------------------------------------------------------------
-- 3) RLS
-- ------------------------------------------------------------
alter table public.exports enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'exports' and policyname = 'exports_select'
  ) then
    create policy "exports_select" on public.exports
      for select using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'exports' and policyname = 'exports_insert'
  ) then
    create policy "exports_insert" on public.exports
      for insert with check (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'exports' and policyname = 'exports_update'
  ) then
    create policy "exports_update" on public.exports
      for update using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'exports' and policyname = 'exports_delete'
  ) then
    create policy "exports_delete" on public.exports
      for delete using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

notify pgrst, 'reload schema';
