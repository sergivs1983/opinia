-- ============================================================
-- OpinIA — Content Intelligence MVP (GLOBAL)
--
-- Adds:
--   - content_insights
--   - content_suggestions
--
-- Idempotent migration.
-- ============================================================

-- ------------------------------------------------------------
-- 1) content_insights
-- ------------------------------------------------------------
create table if not exists public.content_insights (
  id                        uuid primary key default uuid_generate_v4(),
  business_id               uuid not null references public.businesses(id) on delete cascade,
  week_start                date not null,
  source_platforms          text[] not null default array[]::text[],
  language                  text not null check (language in ('ca', 'es', 'en')),
  themes                    jsonb not null,
  derived_business_profile  jsonb,
  created_at                timestamptz not null default now(),
  unique (business_id, week_start, language)
);

create index if not exists idx_content_insights_business_week
  on public.content_insights(business_id, week_start desc);

-- ------------------------------------------------------------
-- 2) content_suggestions
-- ------------------------------------------------------------
create table if not exists public.content_suggestions (
  id           uuid primary key default uuid_generate_v4(),
  insight_id   uuid not null references public.content_insights(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  language     text not null check (language in ('ca', 'es', 'en')),
  type         text not null check (type in ('reel', 'story', 'post')),
  title        text,
  hook         text,
  shot_list    jsonb,
  caption      text,
  cta          text,
  best_time    text,
  hashtags     text[] not null default array[]::text[],
  evidence     jsonb,
  status       text not null default 'draft' check (status in ('draft', 'approved', 'published')),
  created_at   timestamptz not null default now()
);

create index if not exists idx_content_suggestions_insight
  on public.content_suggestions(insight_id);

create index if not exists idx_content_suggestions_business
  on public.content_suggestions(business_id, status, created_at desc);

-- ------------------------------------------------------------
-- 3) RLS
-- ------------------------------------------------------------
alter table public.content_insights enable row level security;
alter table public.content_suggestions enable row level security;

-- content_insights policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_insights' AND policyname = 'content_insights_select'
  ) THEN
    CREATE POLICY "content_insights_select" ON public.content_insights
      FOR SELECT USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_insights' AND policyname = 'content_insights_insert'
  ) THEN
    CREATE POLICY "content_insights_insert" ON public.content_insights
      FOR INSERT WITH CHECK (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_insights' AND policyname = 'content_insights_update'
  ) THEN
    CREATE POLICY "content_insights_update" ON public.content_insights
      FOR UPDATE USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_insights' AND policyname = 'content_insights_delete'
  ) THEN
    CREATE POLICY "content_insights_delete" ON public.content_insights
      FOR DELETE USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

-- content_suggestions policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_suggestions' AND policyname = 'content_suggestions_select'
  ) THEN
    CREATE POLICY "content_suggestions_select" ON public.content_suggestions
      FOR SELECT USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_suggestions' AND policyname = 'content_suggestions_insert'
  ) THEN
    CREATE POLICY "content_suggestions_insert" ON public.content_suggestions
      FOR INSERT WITH CHECK (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_suggestions' AND policyname = 'content_suggestions_update'
  ) THEN
    CREATE POLICY "content_suggestions_update" ON public.content_suggestions
      FOR UPDATE USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'content_suggestions' AND policyname = 'content_suggestions_delete'
  ) THEN
    CREATE POLICY "content_suggestions_delete" ON public.content_suggestions
      FOR DELETE USING (business_id IN (SELECT public.user_biz_ids()));
  END IF;
END $$;

notify pgrst, 'reload schema';
