begin;

alter table public.organizations
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists trial_state text,
  add column if not exists trial_plan_code text;

alter table public.organizations
  alter column trial_started_at set default now(),
  alter column trial_ends_at set default (now() + interval '14 days'),
  alter column trial_state set default 'active',
  alter column trial_plan_code set default 'business';

update public.organizations
set
  trial_started_at = coalesce(trial_started_at, now()),
  trial_ends_at = coalesce(trial_ends_at, coalesce(trial_started_at, now()) + interval '14 days'),
  trial_state = case
    when trial_state is null or btrim(trial_state) = '' then 'active'
    when trial_state in ('none', 'active', 'ended') then trial_state
    else 'active'
  end,
  trial_plan_code = case
    when trial_plan_code is null or btrim(trial_plan_code) = '' then 'business'
    else trial_plan_code
  end;

update public.organizations
set trial_state = 'ended'
where trial_ends_at is not null
  and trial_ends_at < now()
  and trial_state = 'active';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organizations'::regclass
      and conname = 'organizations_trial_state_check'
  ) then
    alter table public.organizations
      add constraint organizations_trial_state_check
      check (trial_state in ('none', 'active', 'ended'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organizations'::regclass
      and conname = 'organizations_trial_plan_code_check'
  ) then
    alter table public.organizations
      add constraint organizations_trial_plan_code_check
      check (trial_plan_code in ('starter', 'business', 'scale', 'enterprise', 'pro'));
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
