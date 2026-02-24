-- ============================================================
-- OpinIA Phase B — knowledge_base_entries
-- Run AFTER schema-v2.sql + schema-v2-extensions.sql
-- Creates NEW table only — NO modifications to existing tables.
-- ============================================================

-- 1) TABLE
create table if not exists public.knowledge_base_entries (
  id                 uuid primary key default uuid_generate_v4(),
  biz_id             uuid not null references public.businesses(id) on delete cascade,
  org_id             uuid not null references public.organizations(id) on delete cascade,
  category           text not null default 'altres',
  triggers           text[] not null default array[]::text[],
  content            text not null,
  sentiment_context  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table  public.knowledge_base_entries is 'Business Memory — facts the AI can reference. Never invents beyond these.';
comment on column public.knowledge_base_entries.triggers is 'Keywords that activate this entry when found in a review.';
comment on column public.knowledge_base_entries.category is 'parking, wifi, horaris, política, menú, equip, altres, etc.';
comment on column public.knowledge_base_entries.sentiment_context is 'Optional: how to frame this fact in negative vs positive reviews.';

-- 2) INDEXES
create index if not exists idx_kbe_biz
  on public.knowledge_base_entries(biz_id);

create index if not exists idx_kbe_org
  on public.knowledge_base_entries(org_id);

create index if not exists idx_kbe_triggers
  on public.knowledge_base_entries using gin(triggers);

create index if not exists idx_kbe_category
  on public.knowledge_base_entries(biz_id, category);

-- 3) UPDATED_AT TRIGGER
create trigger trg_kbe_updated_at
  before update on public.knowledge_base_entries
  for each row execute function public.trg_set_updated_at();

-- 4) RLS
alter table public.knowledge_base_entries enable row level security;

create policy "kbe_select" on public.knowledge_base_entries
  for select using (org_id in (select public.user_org_ids()));

create policy "kbe_insert" on public.knowledge_base_entries
  for insert with check (org_id in (select public.user_org_ids()));

create policy "kbe_update" on public.knowledge_base_entries
  for update using (org_id in (select public.user_org_ids()));

create policy "kbe_delete" on public.knowledge_base_entries
  for delete using (org_id in (select public.user_org_ids()));
