-- ============================================================
-- OpinIA ONB-1 — 5-minute onboarding (first value)
-- Idempotent migration.
-- ============================================================

-- ------------------------------------------------------------
-- 1) onboarding_progress
-- ------------------------------------------------------------
create table if not exists public.onboarding_progress (
  business_id   uuid primary key references public.businesses(id) on delete cascade,
  step          int not null default 1 check (step between 1 and 4),
  completed     boolean not null default false,
  dismissed     boolean not null default false,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.onboarding_progress add column if not exists business_id uuid;
alter table public.onboarding_progress add column if not exists step int;
alter table public.onboarding_progress add column if not exists completed boolean;
alter table public.onboarding_progress add column if not exists dismissed boolean;
alter table public.onboarding_progress add column if not exists last_seen_at timestamptz;
alter table public.onboarding_progress add column if not exists created_at timestamptz;
alter table public.onboarding_progress add column if not exists updated_at timestamptz;

update public.onboarding_progress
set step = 1
where step is null or step < 1 or step > 4;

update public.onboarding_progress
set completed = false
where completed is null;

update public.onboarding_progress
set dismissed = false
where dismissed is null;

update public.onboarding_progress
set last_seen_at = now()
where last_seen_at is null;

update public.onboarding_progress
set created_at = now()
where created_at is null;

update public.onboarding_progress
set updated_at = now()
where updated_at is null;

alter table public.onboarding_progress alter column step set default 1;
alter table public.onboarding_progress alter column completed set default false;
alter table public.onboarding_progress alter column dismissed set default false;
alter table public.onboarding_progress alter column last_seen_at set default now();
alter table public.onboarding_progress alter column created_at set default now();
alter table public.onboarding_progress alter column updated_at set default now();

alter table public.onboarding_progress alter column business_id set not null;
alter table public.onboarding_progress alter column step set not null;
alter table public.onboarding_progress alter column completed set not null;
alter table public.onboarding_progress alter column dismissed set not null;
alter table public.onboarding_progress alter column last_seen_at set not null;
alter table public.onboarding_progress alter column created_at set not null;
alter table public.onboarding_progress alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'onboarding_progress_business_fk'
  ) then
    alter table public.onboarding_progress
      add constraint onboarding_progress_business_fk
      foreign key (business_id) references public.businesses(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'onboarding_progress_step_ck'
  ) then
    alter table public.onboarding_progress
      add constraint onboarding_progress_step_ck
      check (step between 1 and 4);
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) updated_at trigger
-- ------------------------------------------------------------
drop trigger if exists trg_onboarding_progress_updated_at on public.onboarding_progress;
create trigger trg_onboarding_progress_updated_at
  before update on public.onboarding_progress
  for each row execute function public.trg_set_updated_at();

-- ------------------------------------------------------------
-- 3) RLS
-- ------------------------------------------------------------
alter table public.onboarding_progress enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_progress' and policyname = 'onboarding_progress_select'
  ) then
    create policy "onboarding_progress_select" on public.onboarding_progress
      for select using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_progress' and policyname = 'onboarding_progress_insert'
  ) then
    create policy "onboarding_progress_insert" on public.onboarding_progress
      for insert with check (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_progress' and policyname = 'onboarding_progress_update'
  ) then
    create policy "onboarding_progress_update" on public.onboarding_progress
      for update using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'onboarding_progress' and policyname = 'onboarding_progress_delete'
  ) then
    create policy "onboarding_progress_delete" on public.onboarding_progress
      for delete using (business_id in (select public.user_biz_ids()));
  end if;
end $$;

notify pgrst, 'reload schema';
