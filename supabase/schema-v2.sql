-- ============================================================
-- OpinIA v2 — Production Multi-Tenant SaaS Schema
-- ============================================================
-- Architecture: Org → Business (multi-location) → Reviews → Replies
-- Auth: Supabase Auth → profile auto-created → user joins org via memberships
-- Security: RLS enforced at org + business level via memberships table
--
-- Safe to run on a fresh Supabase project.
-- Order: extensions → types → tables → indexes → functions → triggers → RLS → policies
-- ============================================================


-- ============================================================
-- 0) CLEANUP (idempotent re-run)
-- ============================================================
-- DROP TABLE CASCADE removes policies, triggers, indexes automatically.
-- This is the safest approach — no PL/pgSQL exception handling needed.
drop table if exists public.sync_log      cascade;
drop table if exists public.replies       cascade;
drop table if exists public.reviews       cascade;
drop table if exists public.integrations  cascade;
drop table if exists public.businesses    cascade;
drop table if exists public.memberships   cascade;
drop table if exists public.profiles      cascade;
drop table if exists public.organizations cascade;

-- functions
drop function if exists public.handle_new_user()       cascade;
drop function if exists public.trg_set_updated_at()    cascade;
drop function if exists public.user_org_ids()          cascade;
drop function if exists public.user_biz_ids()          cascade;
drop function if exists public.user_biz_ids_with_role(text[]) cascade;

-- types
drop type if exists public.reply_status cascade;
drop type if exists public.sync_status cascade;
drop type if exists public.integration_provider cascade;
drop type if exists public.review_source cascade;
drop type if exists public.reply_tone cascade;
drop type if exists public.sentiment cascade;
drop type if exists public.formality cascade;
drop type if exists public.biz_type cascade;
drop type if exists public.member_role cascade;


-- ============================================================
-- 1) EXTENSIONS
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";


-- ============================================================
-- 2) CUSTOM TYPES
-- ============================================================
create type public.member_role          as enum ('owner','manager','staff');
create type public.biz_type             as enum ('restaurant','hotel','apartment','bar','cafe','shop','other');
create type public.formality            as enum ('tu','voste');
create type public.sentiment            as enum ('positive','neutral','negative');
create type public.reply_tone           as enum ('proper','professional','premium');
create type public.review_source        as enum ('google','tripadvisor','booking','manual','other');
create type public.integration_provider as enum ('google_business','tripadvisor_api','booking_api');
create type public.sync_status          as enum ('pending','running','success','failed');
create type public.reply_status         as enum ('draft','selected','published','archived');


-- ============================================================
-- 3) TABLES
-- ============================================================

-- 3a) Organizations (accounts / billing units)
-- One per company. Holds plan info, billing, usage limits.
create table public.organizations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text unique,                            -- vanity URL: app.opinia.cat/acme
  plan        text not null default 'free',           -- free | starter | pro | enterprise
  max_businesses integer not null default 1,          -- plan limit
  max_reviews_mo integer not null default 50,         -- monthly AI-generation cap
  stripe_customer_id text,                            -- for billing
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table  public.organizations is 'Billing unit. One company = one org. Owns businesses.';
comment on column public.organizations.plan is 'Subscription tier. Drives feature gates in app.';


-- 3b) Profiles (1:1 with auth.users)
-- Lightweight user record. No org reference here — memberships handle that.
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_url  text,
  locale      text not null default 'ca',             -- preferred UI language
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'One per Supabase auth user. Memberships link to orgs.';


-- 3c) Memberships (user ↔ org, with role)
-- A user can belong to multiple orgs. Each membership has a role.
create table public.memberships (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  role        public.member_role not null default 'staff',
  is_default  boolean not null default false,         -- which org loads on login
  invited_email text,                                 -- for pending invites
  accepted_at timestamptz,                            -- null = invite pending
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, org_id)
);

comment on table  public.memberships is 'Join table: users ↔ orgs. One row per user per org.';
comment on column public.memberships.is_default is 'The org that loads by default on login.';


-- 3d) Businesses (locations within an org)
-- Each org can have many businesses (hotel + restaurant + cafe in same group).
-- This replaces the old "settings" table — business config lives here.
create table public.businesses (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  name              text not null,
  slug              text,                              -- unique within org
  type              public.biz_type not null default 'restaurant',
  url               text,
  address           text,
  city              text,
  country           text default 'ES',
  google_place_id   text,                              -- for Google API matching
  tags              text[] not null default array[]::text[],
  default_signature text not null default '',
  formality         public.formality not null default 'voste',
  default_language  text not null default 'ca',
  ai_instructions   text,                              -- custom prompt context per business
  is_active         boolean not null default true,
  onboarding_done   boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, slug)
);

comment on table  public.businesses is 'A location/property. Reviews and integrations attach here.';
comment on column public.businesses.ai_instructions is 'Extra context injected into AI prompts for this business.';
comment on column public.businesses.google_place_id is 'Links this business to a Google Maps listing for API sync.';


-- 3e) Integrations (API connections per business)
-- One business can have one Google connection, one TripAdvisor connection, etc.
create table public.integrations (
  id              uuid primary key default uuid_generate_v4(),
  biz_id          uuid not null references public.businesses(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  provider        public.integration_provider not null,
  account_id      text,                                -- external account/location ID
  access_token    text,                                -- encrypted at rest by Supabase Vault ideally
  refresh_token   text,
  token_expires_at timestamptz,
  scopes          text[],
  is_active       boolean not null default true,
  last_sync_at    timestamptz,
  sync_cursor     text,                                -- pagination cursor for incremental sync
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (biz_id, provider)                            -- one provider per business
);

comment on table  public.integrations is 'OAuth tokens for external review sources per business.';
comment on column public.integrations.sync_cursor is 'Stores pagination state for incremental review fetching.';


-- 3f) Reviews
-- Can come from Google sync (external_id set) or manual input (external_id null).
create table public.reviews (
  id                uuid primary key default uuid_generate_v4(),
  biz_id            uuid not null references public.businesses(id) on delete cascade,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  source            public.review_source not null default 'manual',
  external_id       text,                              -- Google review ID, TripAdvisor ID, etc.
  author_name       text,
  author_avatar_url text,
  review_text       text not null,
  rating            integer not null check (rating between 1 and 5),
  sentiment         public.sentiment not null default 'neutral',
  language_detected text not null default 'ca',
  review_date       timestamptz,                       -- when the customer wrote it (may differ from created_at)
  is_replied        boolean not null default false,     -- quick filter: has a published reply?
  needs_attention   boolean not null default false,     -- flag for bad reviews needing manual action
  metadata          jsonb default '{}'::jsonb,          -- flexible: store platform-specific data
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (biz_id, source, external_id)                 -- prevent duplicate imports
);

comment on table  public.reviews is 'Reviews from all sources. external_id prevents duplicate sync.';
comment on column public.reviews.metadata is 'Platform-specific data (profile URL, photos, etc).';


-- 3g) Replies (AI-generated + user-edited)
create table public.replies (
  id            uuid primary key default uuid_generate_v4(),
  review_id     uuid not null references public.reviews(id) on delete cascade,
  biz_id        uuid not null references public.businesses(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  tone          public.reply_tone not null,
  content       text not null,
  status        public.reply_status not null default 'draft',
  is_edited     boolean not null default false,
  published_at  timestamptz,                           -- when pushed to platform
  published_by  uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table  public.replies is 'AI-generated responses. 3 per review (one per tone). One gets published.';
comment on column public.replies.status is 'draft → selected → published → archived lifecycle.';


-- 3h) Sync Log (audit trail for background sync jobs)
create table public.sync_log (
  id              uuid primary key default uuid_generate_v4(),
  integration_id  uuid not null references public.integrations(id) on delete cascade,
  biz_id          uuid not null references public.businesses(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  status          public.sync_status not null default 'pending',
  reviews_fetched integer default 0,
  reviews_new     integer default 0,
  error_message   text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now()
);

comment on table public.sync_log is 'Tracks every sync run for debugging and billing.';


-- ============================================================
-- 4) INDEXES
-- ============================================================
create index idx_memberships_user     on public.memberships(user_id);
create index idx_memberships_org      on public.memberships(org_id);
create index idx_memberships_default  on public.memberships(user_id) where is_default = true;

create index idx_businesses_org       on public.businesses(org_id);
create index idx_businesses_place     on public.businesses(google_place_id) where google_place_id is not null;

create index idx_integrations_biz     on public.integrations(biz_id);
create index idx_integrations_org     on public.integrations(org_id);
create index idx_integrations_active  on public.integrations(biz_id) where is_active = true;

create index idx_reviews_biz          on public.reviews(biz_id);
create index idx_reviews_org          on public.reviews(org_id);
create index idx_reviews_created      on public.reviews(created_at desc);
create index idx_reviews_source       on public.reviews(biz_id, source);
create index idx_reviews_external     on public.reviews(biz_id, source, external_id);
create index idx_reviews_needs_attn   on public.reviews(biz_id) where needs_attention = true;
create index idx_reviews_unreplied    on public.reviews(biz_id) where is_replied = false;

create index idx_replies_review       on public.replies(review_id);
create index idx_replies_biz          on public.replies(biz_id);
create index idx_replies_org          on public.replies(org_id);
create index idx_replies_status       on public.replies(review_id, status);

create index idx_sync_log_integration on public.sync_log(integration_id);
create index idx_sync_log_biz         on public.sync_log(biz_id);


-- ============================================================
-- 5) FUNCTIONS
-- ============================================================

-- 5a) Generic updated_at trigger
create or replace function public.trg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- 5b) Signup handler: create profile + personal org + owner membership
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  _org_id uuid;
  _name   text;
begin
  _name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));

  -- create personal org
  insert into public.organizations (name)
  values (_name || '''s Organization')
  returning id into _org_id;

  -- create profile
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    _name,
    coalesce(new.raw_user_meta_data->>'avatar_url', '')
  );

  -- make them owner of their org
  insert into public.memberships (user_id, org_id, role, is_default, accepted_at)
  values (new.id, _org_id, 'owner', true, now());

  return new;
end;
$$;


-- 5c) Security helper: returns org_ids the current user belongs to
create or replace function public.user_org_ids()
returns setof uuid language sql security definer stable as $$
  select org_id from public.memberships
  where user_id = auth.uid() and accepted_at is not null;
$$;


-- 5d) Security helper: returns biz_ids the current user can access
create or replace function public.user_biz_ids()
returns setof uuid language sql security definer stable as $$
  select b.id from public.businesses b
  where b.org_id in (select public.user_org_ids());
$$;


-- 5e) Security helper: biz_ids filtered by role (for write operations)
create or replace function public.user_biz_ids_with_role(allowed_roles text[])
returns setof uuid language sql security definer stable as $$
  select b.id from public.businesses b
  inner join public.memberships m on m.org_id = b.org_id
  where m.user_id = auth.uid()
    and m.accepted_at is not null
    and m.role::text = any(allowed_roles);
$$;


-- ============================================================
-- 6) TRIGGERS
-- ============================================================
create trigger trg_organizations_updated_at before update on public.organizations
  for each row execute function public.trg_set_updated_at();

create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.trg_set_updated_at();

create trigger trg_memberships_updated_at before update on public.memberships
  for each row execute function public.trg_set_updated_at();

create trigger trg_businesses_updated_at before update on public.businesses
  for each row execute function public.trg_set_updated_at();

create trigger trg_integrations_updated_at before update on public.integrations
  for each row execute function public.trg_set_updated_at();

create trigger trg_reviews_updated_at before update on public.reviews
  for each row execute function public.trg_set_updated_at();

create trigger trg_replies_updated_at before update on public.replies
  for each row execute function public.trg_set_updated_at();

-- auto-create profile on signup
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- 7) ROW LEVEL SECURITY
-- ============================================================
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.memberships   enable row level security;
alter table public.businesses    enable row level security;
alter table public.integrations  enable row level security;
alter table public.reviews       enable row level security;
alter table public.replies       enable row level security;
alter table public.sync_log      enable row level security;


-- ============================================================
-- 8) POLICIES
-- ============================================================

-- ---- Organizations ----
-- Users see orgs they belong to.
create policy "org_select" on public.organizations
  for select using (id in (select public.user_org_ids()));

-- Only owners can update org settings.
create policy "org_update" on public.organizations
  for update using (
    id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role = 'owner' and accepted_at is not null
    )
  );


-- ---- Profiles ----
-- Users see only their own profile.
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_update" on public.profiles
  for update using (id = auth.uid());


-- ---- Memberships ----
-- See memberships for your orgs (so you can see teammates).
create policy "members_select" on public.memberships
  for select using (org_id in (select public.user_org_ids()));

-- Owners and managers can invite (insert).
create policy "members_insert" on public.memberships
  for insert with check (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role in ('owner','manager') and accepted_at is not null
    )
  );

-- Owners can change roles.
create policy "members_update" on public.memberships
  for update using (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role = 'owner' and accepted_at is not null
    )
  );

-- Owners can remove members; users can remove themselves.
create policy "members_delete" on public.memberships
  for delete using (
    user_id = auth.uid()
    or org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role = 'owner' and accepted_at is not null
    )
  );


-- ---- Businesses ----
-- See businesses in your orgs.
create policy "biz_select" on public.businesses
  for select using (org_id in (select public.user_org_ids()));

-- Owners and managers can create businesses.
create policy "biz_insert" on public.businesses
  for insert with check (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role in ('owner','manager') and accepted_at is not null
    )
  );

-- Owners and managers can update.
create policy "biz_update" on public.businesses
  for update using (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role in ('owner','manager') and accepted_at is not null
    )
  );

-- Only owners can delete businesses.
create policy "biz_delete" on public.businesses
  for delete using (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role = 'owner' and accepted_at is not null
    )
  );


-- ---- Integrations ----
-- See integrations for your businesses.
create policy "integrations_select" on public.integrations
  for select using (org_id in (select public.user_org_ids()));

-- Owners/managers can manage integrations.
create policy "integrations_insert" on public.integrations
  for insert with check (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role in ('owner','manager') and accepted_at is not null
    )
  );

create policy "integrations_update" on public.integrations
  for update using (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role in ('owner','manager') and accepted_at is not null
    )
  );

create policy "integrations_delete" on public.integrations
  for delete using (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role = 'owner' and accepted_at is not null
    )
  );


-- ---- Reviews ----
-- Everyone in the org can read reviews.
create policy "reviews_select" on public.reviews
  for select using (org_id in (select public.user_org_ids()));

-- Any member can insert (manual reviews).
create policy "reviews_insert" on public.reviews
  for insert with check (org_id in (select public.user_org_ids()));

-- Owners/managers can update (flag, sentiment, etc).
create policy "reviews_update" on public.reviews
  for update using (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role in ('owner','manager') and accepted_at is not null
    )
  );

-- Only owners can delete reviews.
create policy "reviews_delete" on public.reviews
  for delete using (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role = 'owner' and accepted_at is not null
    )
  );


-- ---- Replies ----
-- Everyone in org can read replies.
create policy "replies_select" on public.replies
  for select using (org_id in (select public.user_org_ids()));

-- Any member can generate/insert replies.
create policy "replies_insert" on public.replies
  for insert with check (org_id in (select public.user_org_ids()));

-- Any member can edit/select a reply.
create policy "replies_update" on public.replies
  for update using (org_id in (select public.user_org_ids()));

-- Only owners/managers can delete.
create policy "replies_delete" on public.replies
  for delete using (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role in ('owner','manager') and accepted_at is not null
    )
  );


-- ---- Sync Log ----
-- Read-only for all org members (audit visibility).
create policy "sync_log_select" on public.sync_log
  for select using (org_id in (select public.user_org_ids()));

-- Only service role inserts (background jobs), but we allow org members for edge functions.
create policy "sync_log_insert" on public.sync_log
  for insert with check (org_id in (select public.user_org_ids()));


-- ============================================================
-- VERIFICATION QUERIES (run manually)
-- ============================================================
-- select tablename from pg_tables where schemaname = 'public' order by tablename;
-- select polname, tablename from pg_policies join pg_class on pg_policies.polrelid = pg_class.oid order by tablename, polname;
-- select * from public.memberships where user_id = auth.uid();
