-- ============================================================
-- OpinIA — Panic Button + Golden Dataset + Negative Constraints
-- Run AFTER schema-v2.sql. Idempotent.
-- ============================================================

-- 1) PANIC BUTTON — columns on businesses
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='panic_mode'
  ) then
    alter table public.businesses
      add column panic_mode boolean not null default false,
      add column panic_reason text,
      add column panic_enabled_at timestamptz;
  end if;
end $$;

-- 2) GOLDEN DATASET — edit diff tracking
create table if not exists public.ai_reply_edits (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  biz_id            uuid not null references public.businesses(id) on delete cascade,
  review_id         uuid not null references public.reviews(id) on delete cascade,
  reply_id          uuid not null references public.replies(id) on delete cascade,
  original_ai_reply text not null,
  final_human_reply text not null,
  diff_score        numeric(5,2) not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists idx_are_biz
  on public.ai_reply_edits (biz_id, created_at desc);

create index if not exists idx_are_review
  on public.ai_reply_edits (review_id);

alter table public.ai_reply_edits enable row level security;

create policy "are_select_org" on public.ai_reply_edits
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

create policy "are_insert_org" on public.ai_reply_edits
  for insert to authenticated
  with check (org_id in (select public.user_org_ids()));

comment on table public.ai_reply_edits is
  'Golden dataset: tracks diff between AI-generated and human-edited replies.';

-- 3) NEGATIVE CONSTRAINTS — column on businesses
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='negative_constraints'
  ) then
    alter table public.businesses
      add column negative_constraints jsonb not null default '[]'::jsonb;
  end if;
end $$;
