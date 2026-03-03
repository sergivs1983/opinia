-- Core baseline bootstrap for migration replay safety.
-- Creates minimum multi-tenant primitives when restoring from partial schema.
-- Idempotent and safe to run on environments that already have full schema.

begin;

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

do $$
begin
  if to_regtype('public.member_role') is null then
    create type public.member_role as enum ('owner', 'manager', 'staff');
  end if;

  if to_regtype('public.integration_provider') is null then
    create type public.integration_provider as enum ('google_business', 'tripadvisor_api', 'booking_api');
  end if;
end
$$;

create table if not exists public.organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null default 'Organization',
  slug text,
  plan text not null default 'starter',
  plan_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizations
  add column if not exists name text not null default 'Organization',
  add column if not exists slug text,
  add column if not exists plan text not null default 'starter',
  add column if not exists plan_code text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.memberships (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role public.member_role not null default 'staff',
  is_default boolean not null default false,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, org_id)
);

alter table public.memberships
  add column if not exists user_id uuid,
  add column if not exists org_id uuid,
  add column if not exists role public.member_role not null default 'staff',
  add column if not exists is_default boolean not null default false,
  add column if not exists accepted_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.businesses (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null default 'Business',
  slug text,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.businesses
  add column if not exists org_id uuid,
  add column if not exists name text not null default 'Business',
  add column if not exists slug text,
  add column if not exists city text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.business_memberships (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);

alter table public.business_memberships
  add column if not exists org_id uuid,
  add column if not exists business_id uuid,
  add column if not exists user_id uuid,
  add column if not exists role public.member_role not null default 'staff',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.integrations (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  provider public.integration_provider not null default 'google_business',
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (biz_id, provider)
);

alter table public.integrations
  add column if not exists org_id uuid,
  add column if not exists biz_id uuid,
  add column if not exists provider public.integration_provider not null default 'google_business',
  add column if not exists token_expires_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.integrations_secrets (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  access_token_enc text,
  refresh_token_enc text,
  key_version integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.integrations_secrets
  add column if not exists integration_id uuid,
  add column if not exists access_token_enc text,
  add column if not exists refresh_token_enc text,
  add column if not exists key_version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.reviews (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  review_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reviews
  add column if not exists org_id uuid,
  add column if not exists biz_id uuid,
  add column if not exists review_text text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.replies (
  id uuid primary key default uuid_generate_v4(),
  review_id uuid references public.reviews(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.replies
  add column if not exists review_id uuid,
  add column if not exists org_id uuid,
  add column if not exists biz_id uuid,
  add column if not exists content text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.lito_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lito_threads
  add column if not exists org_id uuid,
  add column if not exists biz_id uuid,
  add column if not exists user_id uuid,
  add column if not exists title text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.recommendation_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  title text,
  recommendation text,
  generated_copy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.recommendation_log
  add column if not exists org_id uuid,
  add column if not exists biz_id uuid,
  add column if not exists title text,
  add column if not exists recommendation text,
  add column if not exists generated_copy text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

notify pgrst, 'reload schema';

commit;
