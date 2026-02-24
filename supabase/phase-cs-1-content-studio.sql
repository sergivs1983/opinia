-- ============================================================
-- OpinIA CS-1 — Content Studio (assets + social variants)
-- Idempotent migration.
-- ============================================================

-- ------------------------------------------------------------
-- 1) content_assets
-- ------------------------------------------------------------
create table if not exists public.content_assets (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  suggestion_id  uuid references public.content_suggestions(id) on delete set null,
  language       text not null check (language in ('ca', 'es', 'en')),
  format         text not null check (format in ('story', 'feed')),
  template_id    text not null,
  payload        jsonb not null,
  status         text not null default 'created' check (status in ('created', 'failed')),
  storage_path   text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_content_assets_business_created
  on public.content_assets (business_id, created_at desc);

-- ------------------------------------------------------------
-- 2) content_text_posts (optional persistence)
-- ------------------------------------------------------------
create table if not exists public.content_text_posts (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  suggestion_id  uuid references public.content_suggestions(id) on delete set null,
  language       text not null check (language in ('ca', 'es', 'en')),
  platform       text not null check (platform in ('x', 'threads')),
  variants       jsonb not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_content_text_posts_business_created
  on public.content_text_posts (business_id, created_at desc);

-- ------------------------------------------------------------
-- 3) RLS
-- ------------------------------------------------------------
alter table public.content_assets enable row level security;
alter table public.content_text_posts enable row level security;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_text_posts' AND policyname = 'content_text_posts_select'
  ) THEN
    CREATE POLICY "content_text_posts_select" ON public.content_text_posts
      FOR SELECT USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_text_posts' AND policyname = 'content_text_posts_insert'
  ) THEN
    CREATE POLICY "content_text_posts_insert" ON public.content_text_posts
      FOR INSERT WITH CHECK (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_text_posts' AND policyname = 'content_text_posts_update'
  ) THEN
    CREATE POLICY "content_text_posts_update" ON public.content_text_posts
      FOR UPDATE USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_text_posts' AND policyname = 'content_text_posts_delete'
  ) THEN
    CREATE POLICY "content_text_posts_delete" ON public.content_text_posts
      FOR DELETE USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

notify pgrst, 'reload schema';
