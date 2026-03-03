begin;

alter table public.biz_settings
  add column if not exists brand_description text,
  add column if not exists brand_tone text,
  add column if not exists brand_dos text[] not null default '{}'::text[],
  add column if not exists brand_donts text[] not null default '{}'::text[],
  add column if not exists brand_examples_good jsonb not null default '[]'::jsonb,
  add column if not exists brand_examples_bad jsonb not null default '[]'::jsonb,
  add column if not exists default_locale text not null default 'ca',
  add column if not exists autopublish_enabled boolean not null default false,
  add column if not exists wizard_completed_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'biz_settings_default_locale_check'
      and conrelid = 'public.biz_settings'::regclass
  ) then
    alter table public.biz_settings
      add constraint biz_settings_default_locale_check
      check (default_locale in ('ca', 'es', 'en'));
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
