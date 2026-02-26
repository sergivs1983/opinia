# RLS Multi-Tenant Smoke Test

Validates that Row Level Security isolates tenant A data from tenant B.

## Prerequisites

- Two test businesses: **Biz A** (`BIZ_A_ID`) and **Biz B** (`BIZ_B_ID`)
- Two users: **User A** (has `is_active=true` in `business_memberships` for Biz A only)
  and **User B** (has `is_active=true` for Biz B only)
- Run all queries via the **Supabase JS client** (JWT auth) or the SQL editor with
  `SET request.jwt.claims = '{"sub":"<user_uuid>"}'` for manual testing.

---

## Setup (run as service_role)

```sql
-- Create org + businesses
insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B');

insert into public.businesses (id, org_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Biz A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Biz B');

-- Assign User A → Biz A only
insert into public.business_memberships (org_id, business_id, user_id, is_active)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000002',
        '<USER_A_UUID>', true);

-- Assign User B → Biz B only
insert into public.business_memberships (org_id, business_id, user_id, is_active)
values ('bbbbbbbb-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002',
        '<USER_B_UUID>', true);

-- Seed one review per business
insert into public.reviews (id, biz_id, source, external_id, rating, content)
values
  (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000002', 'google', 'ext-a-1', 5, 'Great Biz A!'),
  (gen_random_uuid(), 'bbbbbbbb-0000-0000-0000-000000000002', 'google', 'ext-b-1', 4, 'Good Biz B!');
```

---

## Test A — User A sees only Biz A data

Authenticate as **User A**, then run:

```sql
-- Should return 1 row (Biz A review), NOT the Biz B review
select biz_id, content from public.reviews;

-- Expected: 1 row with biz_id = 'aaaaaaaa-0000-0000-0000-000000000002'
```

## Test B — User B sees only Biz B data

Authenticate as **User B**, then run:

```sql
-- Should return 1 row (Biz B review), NOT the Biz A review
select biz_id, content from public.reviews;

-- Expected: 1 row with biz_id = 'bbbbbbbb-0000-0000-0000-000000000002'
```

## Test C — Cross-tenant INSERT blocked

Authenticated as **User A**, attempt to write to Biz B:

```sql
-- Should fail with RLS policy violation (permission denied)
insert into public.reviews (biz_id, source, external_id, rating, content)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'google', 'injected', 5, 'Injected!');

-- Expected: ERROR — new row violates row-level security policy for table "reviews"
```

## Test D — businesses table scoping

Authenticated as **User A**:

```sql
-- Should return 1 row (Biz A), not Biz B
select id, name from public.businesses;
```

## Test E — integrations_secrets deny-all

Authenticated as **any user** (JWT):

```sql
-- Should return 0 rows (deny-all, no policies)
select * from public.integrations_secrets;
```

---

## Verify pg_policies

Check that all expected policies exist:

```sql
select
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and policyname like '%_biz_%'
order by tablename, policyname;
```

Check RLS is enabled on all tenant tables:

```sql
select
  relname as table_name,
  relrowsecurity as rls_enabled,
  relforcerowsecurity as rls_forced
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
  and relname in (
    'reviews', 'replies', 'integrations', 'sync_log', 'failed_jobs',
    'llm_usage_events', 'knowledge_base_entries', 'kb_entries',
    'review_topics', 'growth_links', 'growth_events', 'insights_daily',
    'ops_actions', 'competitors', 'missions', 'ai_reply_edits',
    'action_triggers', 'notifications',
    'content_insights', 'content_suggestions', 'content_assets',
    'content_text_posts', 'content_planner_items', 'exports',
    'onboarding_progress', 'metrics_daily', 'connectors',
    'webhook_deliveries', 'social_posts',
    'businesses', 'memberships', 'business_memberships',
    'integrations_secrets'
  )
order by table_name;

-- All rows should have rls_enabled = true
```

---

## 6.1 Checks — RLS Add-ons (business_memberships + backup table)

Validates that the Bloc 6.1 migration is correctly applied for the two manually-versioned tables.

### 6.1-A — business_memberships: SELECT returns only own rows

Authenticated as **User A** (JWT):

```sql
-- Should return only the rows where user_id = User A's UUID.
-- Must NOT return rows belonging to User B.
select user_id, business_id, is_active
from public.business_memberships;

-- Expected: all returned rows have user_id = '<USER_A_UUID>'
```

Verify with pg_policies (run as service_role):

```sql
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename  = 'business_memberships'
order by policyname;

-- Expected: 4 policies —
--   business_memberships_biz_select  (SELECT)  qual: (user_id = auth.uid())
--   business_memberships_biz_insert  (INSERT)  with_check: false
--   business_memberships_biz_update  (UPDATE)  qual: false
--   business_memberships_biz_delete  (DELETE)  qual: false
```

### 6.1-B — business_memberships: mutations blocked for JWT users

Authenticated as **User A**, attempt mutations:

```sql
-- INSERT: must fail with RLS policy violation
insert into public.business_memberships (org_id, business_id, user_id, is_active)
values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000002',
  '<USER_A_UUID>', true
);
-- Expected: ERROR — new row violates row-level security policy

-- UPDATE: must affect 0 rows (USING false blocks the match)
update public.business_memberships
set is_active = false
where user_id = '<USER_A_UUID>';
-- Expected: UPDATE 0

-- DELETE: must affect 0 rows
delete from public.business_memberships
where user_id = '<USER_A_UUID>';
-- Expected: DELETE 0
```

### 6.1-C — _memberships_default_backup_20260220: deny-all for JWT users

Authenticated as **any JWT user**:

```sql
-- SELECT: must return 0 rows (USING false)
select count(*) from public._memberships_default_backup_20260220;
-- Expected: 0

-- INSERT: must fail
insert into public._memberships_default_backup_20260220
select * from public.memberships limit 1;
-- Expected: ERROR — new row violates row-level security policy
```

Verify RLS is enabled and policies exist (run as service_role):

```sql
-- Confirm RLS enabled
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname = '_memberships_default_backup_20260220';
-- Expected: relrowsecurity = true

-- Confirm 4 deny-all policies
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename  = '_memberships_default_backup_20260220'
order by policyname;
-- Expected: 4 policies (deny_select, deny_insert, deny_update, deny_delete)
--   all with qual = false or with_check = false
```

---

## Cleanup (run as service_role)

```sql
delete from public.business_memberships
where user_id in ('<USER_A_UUID>', '<USER_B_UUID>');

delete from public.reviews
where biz_id in (
  'aaaaaaaa-0000-0000-0000-000000000002',
  'bbbbbbbb-0000-0000-0000-000000000002'
);

delete from public.businesses
where id in (
  'aaaaaaaa-0000-0000-0000-000000000002',
  'bbbbbbbb-0000-0000-0000-000000000002'
);

delete from public.organizations
where id in (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000001'
);
```
