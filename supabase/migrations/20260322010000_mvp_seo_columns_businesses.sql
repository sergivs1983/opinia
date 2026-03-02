-- MVP SEO columns for businesses.
-- Keeps backward compatibility with legacy seo_aggressivity while enforcing canonical seo_aggressiveness.

begin;

-- 1) seo_enabled
alter table public.businesses
  add column if not exists seo_enabled boolean;

update public.businesses
set seo_enabled = false
where seo_enabled is null;

alter table public.businesses
  alter column seo_enabled set default false,
  alter column seo_enabled set not null;

-- 2) seo_keywords (canonical text[])
do $$
declare
  seo_keywords_udt text;
begin
  select c.udt_name
    into seo_keywords_udt
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'businesses'
    and c.column_name = 'seo_keywords';

  if seo_keywords_udt is null then
    execute 'alter table public.businesses add column seo_keywords text[]';
  elsif seo_keywords_udt <> '_text' then
    execute $sql$
      alter table public.businesses
      alter column seo_keywords type text[]
      using (
        case
          when seo_keywords is null then array[]::text[]
          when btrim(seo_keywords::text) in ('', '""') then array[]::text[]
          else regexp_split_to_array(replace(seo_keywords::text, '"', ''), '\\s*,\\s*')
        end
      )
    $sql$;
  end if;
end
$$;

update public.businesses
set seo_keywords = array[]::text[]
where seo_keywords is null;

alter table public.businesses
  alter column seo_keywords set default array[]::text[],
  alter column seo_keywords set not null;

-- 3) seo_aggressiveness (1..3), with fallback from legacy seo_aggressivity
DO $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'businesses'
      and column_name = 'seo_aggressiveness'
  ) then
    execute 'alter table public.businesses add column seo_aggressiveness integer';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'businesses'
      and column_name = 'seo_aggressivity'
  ) then
    execute $sql$
      update public.businesses
      set seo_aggressiveness = greatest(1, least(3, coalesce(seo_aggressivity, 1)))
      where seo_aggressiveness is null
    $sql$;
  end if;
end
$$;

update public.businesses
set seo_aggressiveness = 1
where seo_aggressiveness is null;

update public.businesses
set seo_aggressiveness = greatest(1, least(3, seo_aggressiveness));

alter table public.businesses
  alter column seo_aggressiveness set default 1,
  alter column seo_aggressiveness set not null;

DO $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_seo_aggressiveness_range_chk'
  ) then
    alter table public.businesses
      add constraint businesses_seo_aggressiveness_range_chk
      check (seo_aggressiveness between 1 and 3);
  end if;
end
$$;

commit;
