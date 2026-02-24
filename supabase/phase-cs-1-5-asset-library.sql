-- ============================================================
-- OpinIA CS-1.5 — Asset Library (Storage + History + Reuse)
-- Idempotent migration.
-- ============================================================

-- ------------------------------------------------------------
-- 0) Private bucket for generated assets
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('content-assets', 'content-assets', false)
on conflict (id) do update set public = excluded.public;

-- ------------------------------------------------------------
-- 1) content_assets (create full shape if table does not exist)
-- ------------------------------------------------------------
create table if not exists public.content_assets (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  suggestion_id  uuid references public.content_suggestions(id) on delete set null,
  language       text not null check (language in ('ca', 'es', 'en')),
  format         text not null check (format in ('story', 'feed')),
  template_id    text not null,
  status         text not null default 'created' check (status in ('created', 'failed')),
  storage_bucket text not null default 'content-assets',
  storage_path   text not null,
  width          int not null,
  height         int not null,
  bytes          int not null,
  payload        jsonb not null,
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) Backfill / alter existing content_assets columns
-- ------------------------------------------------------------
alter table public.content_assets add column if not exists storage_bucket text;
alter table public.content_assets add column if not exists storage_path text;
alter table public.content_assets add column if not exists width int;
alter table public.content_assets add column if not exists height int;
alter table public.content_assets add column if not exists bytes int;
alter table public.content_assets add column if not exists payload jsonb;
alter table public.content_assets add column if not exists status text;
alter table public.content_assets add column if not exists created_at timestamptz default now();

update public.content_assets
set storage_bucket = 'content-assets'
where storage_bucket is null or storage_bucket = '';

update public.content_assets
set storage_path = concat('content-assets/', business_id::text, '/legacy/', id::text, '_legacy.png')
where storage_path is null or storage_path = '';

update public.content_assets
set width = case when format = 'story' then 1080 else 1080 end
where width is null;

update public.content_assets
set height = case when format = 'story' then 1920 else 1350 end
where height is null;

update public.content_assets
set bytes = 0
where bytes is null;

update public.content_assets
set payload = '{}'::jsonb
where payload is null;

update public.content_assets
set status = 'created'
where status is null;

alter table public.content_assets alter column storage_bucket set default 'content-assets';
alter table public.content_assets alter column status set default 'created';
alter table public.content_assets alter column created_at set default now();

alter table public.content_assets alter column storage_bucket set not null;
alter table public.content_assets alter column storage_path set not null;
alter table public.content_assets alter column width set not null;
alter table public.content_assets alter column height set not null;
alter table public.content_assets alter column bytes set not null;
alter table public.content_assets alter column payload set not null;
alter table public.content_assets alter column status set not null;
alter table public.content_assets alter column created_at set not null;

-- ------------------------------------------------------------
-- 3) Indexes
-- ------------------------------------------------------------
create index if not exists idx_content_assets_business_created
  on public.content_assets (business_id, created_at desc);

create index if not exists idx_content_assets_business_format
  on public.content_assets (business_id, format);

create index if not exists idx_content_assets_business_language
  on public.content_assets (business_id, language);

create unique index if not exists ux_content_assets_storage_path
  on public.content_assets (storage_path);

-- ------------------------------------------------------------
-- 4) RLS
-- ------------------------------------------------------------
alter table public.content_assets enable row level security;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_assets' AND policyname = 'content_assets_select'
  ) THEN
    CREATE POLICY "content_assets_select" ON public.content_assets
      FOR SELECT USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_assets' AND policyname = 'content_assets_insert'
  ) THEN
    CREATE POLICY "content_assets_insert" ON public.content_assets
      FOR INSERT WITH CHECK (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_assets' AND policyname = 'content_assets_update'
  ) THEN
    CREATE POLICY "content_assets_update" ON public.content_assets
      FOR UPDATE USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_assets' AND policyname = 'content_assets_delete'
  ) THEN
    CREATE POLICY "content_assets_delete" ON public.content_assets
      FOR DELETE USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

notify pgrst, 'reload schema';
