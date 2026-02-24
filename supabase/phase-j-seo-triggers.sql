-- ============================================================
-- OpinIA — SEO Natural v2 + Action Triggers + Notifications
-- Run AFTER schema-v2.sql and phase-seo-keywords.sql. Idempotent.
-- ============================================================

-- A1) Add seo_enabled + seo_rules to businesses (additive)
do $$ begin
  -- seo_enabled (replaces conceptual seo_mode but we keep both for compat)
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='seo_enabled'
  ) then
    alter table public.businesses
      add column seo_enabled boolean not null default false;
    comment on column public.businesses.seo_enabled is
      'Master toggle for SEO keyword injection in AI replies.';
  end if;

  -- seo_keywords (new canonical name; target_keywords kept for compat)
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='seo_keywords'
  ) then
    alter table public.businesses
      add column seo_keywords text[] not null default array[]::text[];
    comment on column public.businesses.seo_keywords is
      'SEO keywords to weave naturally into AI responses.';
  end if;

  -- seo_rules jsonb
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='seo_rules'
  ) then
    alter table public.businesses
      add column seo_rules jsonb not null default '{"max_keywords_per_reply":2,"avoid_if_negative":true,"min_rating_for_keywords":4}'::jsonb;
    comment on column public.businesses.seo_rules is
      'Rules for SEO injection: max keywords per reply, sentiment filters, rating threshold.';
  end if;
end $$;


-- A2) action_triggers table
create table if not exists public.action_triggers (
  id                      uuid primary key default uuid_generate_v4(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  biz_id                  uuid not null references public.businesses(id) on delete cascade,
  name                    text not null,
  is_enabled              boolean not null default true,
  match_topics            text[] not null default array[]::text[],
  match_phrases           text[] not null default array[]::text[],
  min_rating              int,
  sentiment_filter        text check (sentiment_filter in ('negative','neutral','positive')),
  action_type             text not null check (action_type in ('email','slack','webhook','in_app_alert')),
  action_target           text,
  action_payload_template jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.action_triggers is 'Automated triggers: when a review matches conditions, fire an action.';

-- Indexes
create index if not exists idx_action_triggers_biz on public.action_triggers(biz_id);
create index if not exists idx_action_triggers_topics on public.action_triggers using gin(match_topics);
create index if not exists idx_action_triggers_phrases on public.action_triggers using gin(match_phrases);

-- RLS (same pattern as businesses)
alter table public.action_triggers enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'action_triggers' and policyname = 'triggers_select') then
    create policy "triggers_select" on public.action_triggers
      for select using (org_id in (select public.user_org_ids()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'action_triggers' and policyname = 'triggers_insert') then
    create policy "triggers_insert" on public.action_triggers
      for insert with check (
        org_id in (
          select org_id from public.memberships
          where user_id = auth.uid() and role in ('owner','manager') and accepted_at is not null
        )
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'action_triggers' and policyname = 'triggers_update') then
    create policy "triggers_update" on public.action_triggers
      for update using (
        org_id in (
          select org_id from public.memberships
          where user_id = auth.uid() and role in ('owner','manager') and accepted_at is not null
        )
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'action_triggers' and policyname = 'triggers_delete') then
    create policy "triggers_delete" on public.action_triggers
      for delete using (
        org_id in (
          select org_id from public.memberships
          where user_id = auth.uid() and role in ('owner','manager') and accepted_at is not null
        )
      );
  end if;
end $$;

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists action_triggers_updated on public.action_triggers;
create trigger action_triggers_updated
  before update on public.action_triggers
  for each row execute function public.set_updated_at();


-- A3) notifications table
create table if not exists public.notifications (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  biz_id      uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  review_id   uuid references public.reviews(id) on delete cascade,
  trigger_id  uuid references public.action_triggers(id) on delete set null,
  type        text not null default 'in_app_alert',
  title       text not null,
  body        text,
  payload     jsonb not null default '{}'::jsonb,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.notifications is 'In-app notifications for trigger events and system alerts.';

create index if not exists idx_notifications_biz on public.notifications(biz_id, created_at desc);
create index if not exists idx_notifications_user on public.notifications(user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'notifications' and policyname = 'notif_select') then
    create policy "notif_select" on public.notifications
      for select using (org_id in (select public.user_org_ids()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'notifications' and policyname = 'notif_insert') then
    create policy "notif_insert" on public.notifications
      for insert with check (org_id in (select public.user_org_ids()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'notifications' and policyname = 'notif_update') then
    create policy "notif_update" on public.notifications
      for update using (org_id in (select public.user_org_ids()));
  end if;
end $$;
