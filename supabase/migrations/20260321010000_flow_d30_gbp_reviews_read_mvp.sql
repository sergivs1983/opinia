begin;

create table if not exists public.gbp_reviews (
  id uuid primary key default gen_random_uuid(),
  biz_id uuid not null references public.businesses(id) on delete cascade,
  gbp_review_id text not null unique,
  star_rating int not null check (star_rating between 1 and 5),
  comment_preview text not null default '',
  reviewer_label text not null default 'Un client',
  create_time timestamptz not null,
  has_reply boolean not null default false,
  reply_time timestamptz null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gbp_reviews_comment_preview_len_check check (char_length(comment_preview) <= 280)
);

create index if not exists idx_gbp_reviews_biz_create_time_desc
  on public.gbp_reviews (biz_id, create_time desc);

create index if not exists idx_gbp_reviews_biz_reply_rating_create_desc
  on public.gbp_reviews (biz_id, has_reply, star_rating, create_time desc);

alter table public.gbp_reviews enable row level security;

drop policy if exists "gbp_reviews_select_authenticated_scope" on public.gbp_reviews;
create policy "gbp_reviews_select_authenticated_scope"
  on public.gbp_reviews
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = gbp_reviews.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = gbp_reviews.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "gbp_reviews_insert_authenticated_scope" on public.gbp_reviews;
create policy "gbp_reviews_insert_authenticated_scope"
  on public.gbp_reviews
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = gbp_reviews.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = gbp_reviews.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "gbp_reviews_update_authenticated_scope" on public.gbp_reviews;
create policy "gbp_reviews_update_authenticated_scope"
  on public.gbp_reviews
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = gbp_reviews.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = gbp_reviews.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  )
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = gbp_reviews.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = gbp_reviews.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "gbp_reviews_service_role_all" on public.gbp_reviews;
create policy "gbp_reviews_service_role_all"
  on public.gbp_reviews
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
