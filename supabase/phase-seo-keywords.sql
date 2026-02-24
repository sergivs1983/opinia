-- ============================================================
-- OpinIA — SEO Natural Keyword Injection
-- Run AFTER schema-v2.sql. Idempotent.
-- ============================================================

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='businesses' and column_name='target_keywords'
  ) then
    alter table public.businesses
      add column target_keywords text[] not null default '{}',
      add column seo_mode boolean not null default true,
      add column seo_aggressiveness integer not null default 1
        check (seo_aggressiveness between 1 and 3);
  end if;
end $$;

comment on column public.businesses.target_keywords is
  'SEO keywords to weave naturally into AI responses (e.g. "millors tapes Barcelona").';
comment on column public.businesses.seo_aggressiveness is
  '1=subtle (max 1 kw/reply), 2=moderate (max 2), 3=aggressive (max 3). Default 1.';
