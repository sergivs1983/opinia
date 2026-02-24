-- ============================================================
-- OpinIA — i18n locale preference on profiles
-- profiles.locale already exists (default 'ca').
-- This adds a CHECK constraint if missing.
-- Idempotent.
-- ============================================================

-- Add check constraint for valid locales
do $$ begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'profiles_locale_check'
  ) then
    alter table public.profiles
      add constraint profiles_locale_check
      check (locale in ('ca', 'es', 'en'));
  end if;
end $$;

comment on column public.profiles.locale is
  'User UI language preference: ca (Catalan), es (Spanish), en (English).';
