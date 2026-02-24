-- ============================================================
-- OpinIA BL-0 — Business Brand Image (logo/cover)
-- Idempotent migration.
-- ============================================================

-- ------------------------------------------------------------
-- 0) Private bucket for business brand images
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('business-images', 'business-images', false)
on conflict (id) do update set public = excluded.public;

-- ------------------------------------------------------------
-- 1) businesses brand image columns
-- ------------------------------------------------------------
alter table public.businesses add column if not exists brand_image_bucket text;
alter table public.businesses add column if not exists brand_image_path text;
alter table public.businesses add column if not exists brand_image_kind text;
alter table public.businesses add column if not exists brand_image_updated_at timestamptz;

update public.businesses
set brand_image_bucket = 'business-images'
where brand_image_bucket is null or brand_image_bucket = '';

update public.businesses
set brand_image_kind = 'logo'
where brand_image_kind is null or brand_image_kind = '';

alter table public.businesses
  alter column brand_image_bucket set default 'business-images';

alter table public.businesses
  alter column brand_image_kind set default 'logo';

alter table public.businesses
  alter column brand_image_bucket set not null;

alter table public.businesses
  alter column brand_image_kind set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_brand_image_kind_ck'
  ) then
    alter table public.businesses
      add constraint businesses_brand_image_kind_ck
      check (brand_image_kind in ('logo', 'cover'));
  end if;
end $$;

create unique index if not exists ux_businesses_brand_image_path
  on public.businesses (brand_image_path);

notify pgrst, 'reload schema';
