-- ============================================================
-- OpinIA - Clean Supabase Schema (org_id everywhere)
-- Safe to re-run
-- Order: extensions -> types -> tables -> indexes -> functions -> triggers -> RLS -> policies
-- ============================================================

-- 0) OPTIONAL CLEANUP (safe re-run)
-- ============================================================
do $$ begin
  -- drop policies first (ignore if missing)
  begin drop policy if exists "org_select" on public.organizations; exception when undefined_object then null; end;
  begin drop policy if exists "org_update" on public.organizations; exception when undefined_object then null; end;

  begin drop policy if exists "profiles_select_self" on public.profiles; exception when undefined_object then null; end;
  begin drop policy if exists "profiles_update_self" on public.profiles; exception when undefined_object then null; end;

  begin drop policy if exists "settings_select_org" on public.settings; exception when undefined_object then null; end;
  begin drop policy if exists "settings_insert_org" on public.settings; exception when undefined_object then null; end;
  begin drop policy if exists "settings_update_org" on public.settings; exception when undefined_object then null; end;

  begin drop policy if exists "reviews_select_org" on public.reviews; exception when undefined_object then null; end;
  begin drop policy if exists "reviews_insert_org" on public.reviews; exception when undefined_object then null; end;
  begin drop policy if exists "reviews_update_org" on public.reviews; exception when undefined_object then null; end;
  begin drop policy if exists "reviews_delete_org" on public.reviews; exception when undefined_object then null; end;

  begin drop policy if exists "replies_select_org" on public.replies; exception when undefined_object then null; end;
  begin drop policy if exists "replies_insert_org" on public.replies; exception when undefined_object then null; end;
  begin drop policy if exists "replies_update_org" on public.replies; exception when undefined_object then null; end;
  begin drop policy if exists "replies_delete_org" on public.replies; exception when undefined_object then null; end;
end $$;

-- drop triggers/functions in correct order
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists update_organizations_updated_at on public.organizations;
drop trigger if exists update_profiles_updated_at on public.profiles;
drop trigger if exists update_settings_updated_at on public.settings;
drop trigger if exists update_reviews_updated_at on public.reviews;
drop trigger if exists update_replies_updated_at on public.replies;

drop function if exists public.handle_new_user();
drop function if exists public.update_updated_at_column();

-- drop tables (children first)
drop table if exists public.replies cascade;
drop table if exists public.reviews cascade;
drop table if exists public.settings cascade;
drop table if exists public.profiles cascade;
drop table if exists public.organizations cascade;

-- drop types (ignore if missing)
do $$ begin
  begin drop type if exists public.reply_tone; exception when undefined_object then null; end;
  begin drop type if exists public.sentiment_type; exception when undefined_object then null; end;
  begin drop type if exists public.formality_level; exception when undefined_object then null; end;
  begin drop type if exists public.business_type; exception when undefined_object then null; end;
end $$;

-- 1) EXTENSIONS
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 2) CUSTOM TYPES
-- ============================================================
do $$ begin
  create type public.business_type as enum ('restaurant','hotel','apartment','bar','cafe','shop','other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.formality_level as enum ('tu','voste');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sentiment_type as enum ('positive','neutral','negative');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.reply_tone as enum ('proper','professional','premium');
exception when duplicate_object then null;
end $$;

-- 3) TABLES
-- ============================================================

-- Organizations
create table if not exists public.organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null default 'My Business',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Settings (1 per org)
create table if not exists public.settings (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  business_name text not null default '',
  business_type public.business_type not null default 'restaurant',
  business_url text,
  tags text[] not null default array[]::text[],
  default_signature text not null default '',
  formality public.formality_level not null default 'voste',
  default_language text not null default 'ca',
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id)
);

-- Reviews
create table if not exists public.reviews (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  review_text text not null,
  rating integer not null check (rating between 1 and 5),
  sentiment public.sentiment_type not null default 'neutral',
  language_detected text not null default 'ca',
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Replies (3 per review typically)
create table if not exists public.replies (
  id uuid primary key default uuid_generate_v4(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  tone public.reply_tone not null,
  content text not null,
  is_selected boolean not null default false,
  is_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4) INDEXES
-- ============================================================
create index if not exists idx_profiles_org on public.profiles(org_id);
create index if not exists idx_settings_org on public.settings(org_id);

create index if not exists idx_reviews_org on public.reviews(org_id);
create index if not exists idx_reviews_user on public.reviews(user_id);
create index if not exists idx_reviews_created on public.reviews(created_at desc);

create index if not exists idx_replies_review on public.replies(review_id);
create index if not exists idx_replies_org on public.replies(org_id);

-- 5) FUNCTIONS
-- ============================================================

-- updated_at helper
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- create org + profile + settings on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  new_org_id uuid;
begin
  insert into public.organizations (name)
  values (coalesce(new.raw_user_meta_data->>'full_name', 'My Business'))
  returning id into new_org_id;

  insert into public.profiles (id, org_id, full_name, avatar_url)
  values (
    new.id,
    new_org_id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', '')
  );

  insert into public.settings (org_id)
  values (new_org_id);

  return new;
end;
$$;

-- 6) TRIGGERS
-- ============================================================

create trigger update_organizations_updated_at
before update on public.organizations
for each row execute function public.update_updated_at_column();

create trigger update_profiles_updated_at
before update on public.profiles
for each row execute function public.update_updated_at_column();

create trigger update_settings_updated_at
before update on public.settings
for each row execute function public.update_updated_at_column();

create trigger update_reviews_updated_at
before update on public.reviews
for each row execute function public.update_updated_at_column();

create trigger update_replies_updated_at
before update on public.replies
for each row execute function public.update_updated_at_column();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 7) ROW LEVEL SECURITY
-- ============================================================
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.reviews enable row level security;
alter table public.replies enable row level security;

-- 8) POLICIES
-- ============================================================

-- Organizations: only your org
create policy "org_select" on public.organizations
for select using (
  id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

create policy "org_update" on public.organizations
for update using (
  id in (select p.org_id from public.profiles p where p.id = auth.uid())
)
with check (
  id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

-- Profiles: self only
create policy "profiles_select_self" on public.profiles
for select using (id = auth.uid());

create policy "profiles_update_self" on public.profiles
for update using (id = auth.uid())
with check (id = auth.uid());

-- Settings: your org only
create policy "settings_select_org" on public.settings
for select using (
  org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

create policy "settings_insert_org" on public.settings
for insert with check (
  org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

create policy "settings_update_org" on public.settings
for update using (
  org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
)
with check (
  org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

-- Reviews: your org only (user must be you for write)
create policy "reviews_select_org" on public.reviews
for select using (
  org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

create policy "reviews_insert_org" on public.reviews
for insert with check (
  user_id = auth.uid()
  and org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

create policy "reviews_update_org" on public.reviews
for update using (
  user_id = auth.uid()
  and org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
)
with check (
  user_id = auth.uid()
  and org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

create policy "reviews_delete_org" on public.reviews
for delete using (
  user_id = auth.uid()
  and org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

-- Replies: your org only
create policy "replies_select_org" on public.replies
for select using (
  org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

create policy "replies_insert_org" on public.replies
for insert with check (
  org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

create policy "replies_update_org" on public.replies
for update using (
  org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
)
with check (
  org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

create policy "replies_delete_org" on public.replies
for delete using (
  org_id in (select p.org_id from public.profiles p where p.id = auth.uid())
);

-- ============================================================
-- QUICK VERIFY
-- ============================================================
-- select tablename from pg_tables where schemaname='public';
-- select * from public.profiles limit 5;
