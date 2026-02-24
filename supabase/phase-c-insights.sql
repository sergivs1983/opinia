-- ============================================================
-- OpinIA Phase C — Insights
-- Run AFTER schema-v2-extensions.sql + phase-b-knowledge-base.sql
-- Extends review_topics for insights aggregation
-- ============================================================

-- 1) Add columns to review_topics
alter table public.review_topics
  add column if not exists org_id    uuid references public.organizations(id) on delete cascade,
  add column if not exists polarity  text not null default 'neutral',
  add column if not exists urgency   text not null default 'low';

-- 2) Backfill org_id from reviews where null
update public.review_topics rt
  set org_id = r.org_id
  from public.reviews r
  where rt.review_id = r.id and rt.org_id is null;

-- 3) Indexes for insights queries
create index if not exists idx_topics_biz_polarity
  on public.review_topics(biz_id, polarity);

create index if not exists idx_topics_biz_created
  on public.review_topics(biz_id, created_at desc);

create index if not exists idx_topics_org
  on public.review_topics(org_id);

-- 4) Insert/delete policies for service_role pipeline writes
-- Drop if exist first to be idempotent
drop policy if exists "topics_insert" on public.review_topics;
drop policy if exists "topics_delete" on public.review_topics;

create policy "topics_insert" on public.review_topics
  for insert with check (true);

create policy "topics_delete" on public.review_topics
  for delete using (true);
