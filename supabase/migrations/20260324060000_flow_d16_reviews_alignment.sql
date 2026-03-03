begin;

alter table public.reviews
  add column if not exists source text not null default 'google',
  add column if not exists external_id text,
  add column if not exists author_name text,
  add column if not exists rating integer not null default 5,
  add column if not exists sentiment text not null default 'neutral',
  add column if not exists language_detected text not null default 'ca',
  add column if not exists is_replied boolean not null default false,
  add column if not exists needs_attention boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists review_date timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reviews_rating_range_check'
      and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews
      add constraint reviews_rating_range_check
      check (rating between 1 and 5);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reviews_sentiment_check'
      and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews
      add constraint reviews_sentiment_check
      check (sentiment in ('positive', 'neutral', 'negative'));
  end if;
end $$;

create unique index if not exists ux_reviews_biz_source_external
  on public.reviews (biz_id, source, external_id)
  where external_id is not null;

create index if not exists idx_reviews_biz_is_replied
  on public.reviews (biz_id, is_replied);

notify pgrst, 'reload schema';

commit;
