-- ============================================================
-- OpinIA Platform — Schema Extensions
-- Run AFTER schema-v2.sql
-- Adds: Brand Voice fields, KB, Topics, Activity, Growth, Usage
-- ============================================================

-- 1) NEW TYPES
-- ============================================================
do $$ begin
  create type public.kb_entry_type as enum ('faq','snippet','policy','sensitive');
exception when duplicate_object then null;
end $$;


-- 2) EXTEND BUSINESSES (Brand Voice fields)
-- ============================================================
alter table public.businesses
  add column if not exists tone_keywords_positive text[] not null default array[]::text[],
  add column if not exists tone_keywords_negative text[] not null default array[]::text[],
  add column if not exists supported_languages    text[] not null default array['ca','es','en']::text[],
  add column if not exists response_max_length    integer not null default 1500,
  add column if not exists auto_publish_enabled   boolean not null default false,
  add column if not exists auto_publish_min_rating integer default 4;


-- 3) KNOWLEDGE BASE
-- ============================================================
create table if not exists public.kb_entries (
  id          uuid primary key default uuid_generate_v4(),
  biz_id      uuid not null references public.businesses(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  type        public.kb_entry_type not null default 'faq',
  topic       text not null,
  content     text not null,
  language    text not null default 'ca',
  is_active   boolean not null default true,
  priority    integer not null default 0,
  used_count  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_kb_biz    on public.kb_entries(biz_id);
create index if not exists idx_kb_org    on public.kb_entries(org_id);
create index if not exists idx_kb_topic  on public.kb_entries(biz_id, topic);
create index if not exists idx_kb_active on public.kb_entries(biz_id) where is_active = true;


-- 4) REVIEW TOPICS (AI-extracted themes)
-- ============================================================
create table if not exists public.review_topics (
  id          uuid primary key default uuid_generate_v4(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  biz_id      uuid not null references public.businesses(id) on delete cascade,
  topic       text not null,
  sentiment   public.sentiment not null,
  confidence  real not null default 0.8,
  created_at  timestamptz not null default now()
);

create index if not exists idx_topics_review on public.review_topics(review_id);
create index if not exists idx_topics_biz    on public.review_topics(biz_id, topic);


-- 5) ACTIVITY LOG
-- ============================================================
create table if not exists public.activity_log (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  biz_id      uuid references public.businesses(id) on delete set null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  action      text not null,
  target_type text,
  target_id   uuid,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_activity_org  on public.activity_log(org_id, created_at desc);
create index if not exists idx_activity_biz  on public.activity_log(biz_id, created_at desc);
create index if not exists idx_activity_user on public.activity_log(user_id, created_at desc);


-- 6) GROWTH LINKS
-- ============================================================
create table if not exists public.growth_links (
  id          uuid primary key default uuid_generate_v4(),
  biz_id      uuid not null references public.businesses(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  slug        text not null unique,
  target_url  text not null,
  qr_style    jsonb default '{}'::jsonb,
  scan_count  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_growth_biz  on public.growth_links(biz_id);
create index if not exists idx_growth_slug on public.growth_links(slug);


-- 7) USAGE TRACKING
-- ============================================================
create table if not exists public.usage_monthly (
  id               uuid primary key default uuid_generate_v4(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  month            date not null,
  ai_generations   integer not null default 0,
  reviews_synced   integer not null default 0,
  reviews_imported integer not null default 0,
  unique (org_id, month)
);

create index if not exists idx_usage_org on public.usage_monthly(org_id, month desc);


-- 8) RLS
-- ============================================================
alter table public.kb_entries     enable row level security;
alter table public.review_topics  enable row level security;
alter table public.activity_log   enable row level security;
alter table public.growth_links   enable row level security;
alter table public.usage_monthly  enable row level security;

-- KB Entries
create policy "kb_select" on public.kb_entries
  for select using (org_id in (select public.user_org_ids()));
create policy "kb_insert" on public.kb_entries
  for insert with check (org_id in (select public.user_org_ids()));
create policy "kb_update" on public.kb_entries
  for update using (org_id in (select public.user_org_ids()));
create policy "kb_delete" on public.kb_entries
  for delete using (org_id in (select public.user_org_ids()));

-- Review Topics (read-only; AI writes via service role)
create policy "topics_select" on public.review_topics
  for select using (biz_id in (select public.user_biz_ids()));

-- Activity Log
create policy "activity_select" on public.activity_log
  for select using (org_id in (select public.user_org_ids()));
create policy "activity_insert" on public.activity_log
  for insert with check (org_id in (select public.user_org_ids()));

-- Growth Links
create policy "growth_select" on public.growth_links
  for select using (org_id in (select public.user_org_ids()));
create policy "growth_insert" on public.growth_links
  for insert with check (org_id in (select public.user_org_ids()));
create policy "growth_update" on public.growth_links
  for update using (org_id in (select public.user_org_ids()));

-- Usage (read-only for members)
create policy "usage_select" on public.usage_monthly
  for select using (org_id in (select public.user_org_ids()));


-- 9) TRIGGERS
-- ============================================================
create trigger trg_kb_entries_updated_at
  before update on public.kb_entries
  for each row execute function public.trg_set_updated_at();

create trigger trg_growth_links_updated_at
  before update on public.growth_links
  for each row execute function public.trg_set_updated_at();


-- ============================================================
-- VERIFY
-- ============================================================
-- select tablename from pg_tables where schemaname = 'public' order by tablename;
-- \d+ public.businesses;
