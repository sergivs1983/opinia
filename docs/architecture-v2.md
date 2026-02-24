# OpinIA v2 — Production SaaS Architecture

## 1. What Changed and Why

The MVP had a flat model: one user → one org → one implicit business. Reviews and settings hung directly off `org_id`. That was fine for a single hotel, but it breaks the moment someone owns a hotel group, a restaurant chain, or even two locations of the same brand.

The v2 schema introduces a proper hierarchy:

```
auth.users
  └── profiles          (1:1, personal info)
  └── memberships       (many-to-many with roles)
        └── organizations   (billing unit, plan limits)
              └── businesses    (individual locations)
                    ├── integrations  (Google API tokens)
                    ├── reviews       (from any source)
                    │     └── replies (AI-generated, 3 per review)
                    └── sync_log     (audit trail)
```

Key architectural decisions:

**Memberships replace the old `profiles.org_id` column.** A user can now belong to multiple organizations with different roles. The old pattern of putting `org_id` on the profile was a single-tenant shortcut that had to go.

**Businesses replace the old `settings` table.** In v1, "settings" was really "the one business this org has." Now each org can have multiple businesses, each with its own name, type, formality level, tags, language, and AI instructions. The business is the unit that reviews attach to.

**Integrations are per-business, not per-org.** A hotel and a restaurant in the same group will have different Google Business Profile listings. Each business stores its own OAuth tokens and sync state.

**Reviews now track their source.** A `source` enum (google, tripadvisor, booking, manual) plus `external_id` plus a unique constraint on `(biz_id, source, external_id)` prevents duplicate imports during sync. The `review_date` field separates "when the customer wrote it" from "when we imported it."

**Replies have a lifecycle.** Instead of a simple `is_selected` boolean, replies now have a `status` enum: `draft → selected → published → archived`. This supports the flow where AI generates 3 drafts, the user picks one, optionally edits it, and eventually publishes it back to Google.


---

## 2. Entity Relationships in Detail

### Organizations → Businesses (1:many)
An organization is a billing entity. It maps to one Stripe customer. Plan limits (max businesses, monthly AI generation cap) live here. A hotel group like H10 would be one organization with many businesses underneath.

### Users → Memberships → Organizations (many-to-many)
A user joins organizations through memberships. Each membership has a role: `owner`, `manager`, or `staff`. Roles gate permissions in RLS policies:

| Action | owner | manager | staff |
|--------|-------|---------|-------|
| Update org settings | ✅ | ❌ | ❌ |
| Create/edit businesses | ✅ | ✅ | ❌ |
| Delete businesses | ✅ | ❌ | ❌ |
| Manage integrations | ✅ | ✅ | ❌ |
| Insert manual reviews | ✅ | ✅ | ✅ |
| Generate AI replies | ✅ | ✅ | ✅ |
| Publish replies | ✅ | ✅ | ❌ |
| Delete reviews/replies | ✅ | ✅ (replies) | ❌ |
| Invite members | ✅ | ✅ | ❌ |
| Remove members | ✅ | ❌ | self only |

The `is_default` flag on memberships determines which org loads when a user logs in — the workspace switcher pattern.

### Businesses → Reviews (1:many)
Reviews belong to a specific business. They can come from automated sync (source = 'google', external_id set) or manual input (source = 'manual', external_id null). The unique constraint on `(biz_id, source, external_id)` is critical — it's what makes sync idempotent.

### Reviews → Replies (1:many, typically 1:3)
Each review gets 3 AI-generated replies (one per tone). The lifecycle is: all start as `draft`, user selects one (status → `selected`), optionally edits it, then publishes (status → `published`). The others become `archived`.

### Businesses → Integrations (1:many, unique per provider)
Each business can connect to one Google Business Profile, one TripAdvisor account, etc. The unique constraint on `(biz_id, provider)` prevents accidental double-connections. Tokens live here, and `sync_cursor` stores pagination state for incremental fetching.


---

## 3. RLS Strategy

All policies funnel through three helper functions to avoid duplicating subqueries:

```sql
-- Returns org IDs the current user belongs to (accepted invites only)
public.user_org_ids() → setof uuid

-- Returns business IDs within those orgs
public.user_biz_ids() → setof uuid

-- Returns business IDs filtered by role (for write operations)
public.user_biz_ids_with_role(allowed_roles text[]) → setof uuid
```

These are `security definer` + `stable`, so Postgres can cache them within a transaction. Every policy uses `org_id in (select user_org_ids())` for reads or adds role checks for writes.

**Why `org_id` is denormalized onto reviews, replies, integrations, and sync_log:** Performance. Without it, every RLS check would need to join through businesses to reach the org. With `org_id` directly on the row, the policy is a simple `IN` check against a cached function. The trade-off is a few extra bytes per row and needing to set org_id correctly on insert — easily enforced by the app layer.


---

## 4. Data Flow Walkthrough

### 4a. Signup
```
User clicks "Sign in with Google"
  → Supabase Auth creates auth.users row
  → Trigger handle_new_user() fires:
      1. Creates organization ("Sergi's Organization")
      2. Creates profile (name, avatar from Google)
      3. Creates membership (role: owner, is_default: true)
  → Redirect to /onboarding
```

### 4b. Onboarding
```
User enters business URL
  → POST /api/business/detect  { url }
  → AI/heuristic extracts: name, type, tags, language, formality
  → User confirms form
  → POST /api/business/create  { org_id, ...fields }
      → INSERT into businesses
  → Redirect to /dashboard
```

### 4c. Google Reviews Connection
```
User clicks "Connect Google Reviews"
  → OAuth flow: redirect to Google consent screen
  → Callback with authorization code
  → POST /api/integrations/google/callback { code, biz_id }
      → Exchange code for access_token + refresh_token
      → Resolve Google account_id / location_id
      → INSERT into integrations
  → Trigger initial sync:
      → POST /api/sync/google { integration_id }
```

### 4d. Review Sync (Background Job)
```
Cron (Vercel Cron or Supabase pg_cron) triggers every 15 min:
  → SELECT active integrations where last_sync_at < now() - interval '15 min'
  → For each integration:
      1. INSERT sync_log (status: running)
      2. Refresh access_token if expired
      3. Fetch reviews from Google Business API (using sync_cursor for pagination)
      4. For each review:
         - Check: does (biz_id, 'google', external_id) exist?
         - If no: INSERT review (with auto-sentiment from rating)
         - If yes: UPDATE if text changed (Google allows edits)
      5. UPDATE integration (last_sync_at, sync_cursor)
      6. UPDATE sync_log (status: success, reviews_fetched, reviews_new)
```

### 4e. AI Response Generation
```
User selects a review in dashboard
  → POST /api/reviews/{id}/generate
  → Server loads:
      - review (text, rating, sentiment, language)
      - business profile (name, type, tags, formality, signature, ai_instructions)
  → Builds prompt with rating-specific guidance (5★ vs 1★)
  → Calls OpenAI API (gpt-4o-mini)
  → Parses 3 responses (proper, professional, premium)
  → INSERT 3 rows into replies (status: draft)
  → Return to client
```

### 4f. Publish Reply
```
User selects a reply → clicks "Publish"
  → POST /api/replies/{id}/publish
  → Server:
      1. UPDATE reply SET status = 'published', published_at = now(), published_by = user_id
      2. UPDATE other replies for same review SET status = 'archived'
      3. UPDATE review SET is_replied = true
      4. (Future) POST to Google Business API to publish the reply
```


---

## 5. Suggested Next.js API Routes

### Auth & Profile
```
GET    /api/auth/callback          # OAuth callback handler
GET    /api/me                     # Current user profile + memberships
PATCH  /api/me                     # Update profile
```

### Organizations
```
GET    /api/orgs                   # List user's orgs
POST   /api/orgs                   # Create new org
PATCH  /api/orgs/[orgId]           # Update org settings
```

### Memberships
```
GET    /api/orgs/[orgId]/members          # List members
POST   /api/orgs/[orgId]/members/invite   # Send invite
PATCH  /api/orgs/[orgId]/members/[id]     # Change role
DELETE /api/orgs/[orgId]/members/[id]     # Remove member
POST   /api/invites/accept               # Accept invite token
```

### Businesses
```
GET    /api/orgs/[orgId]/businesses              # List businesses
POST   /api/orgs/[orgId]/businesses              # Create business
PATCH  /api/orgs/[orgId]/businesses/[bizId]      # Update business
DELETE /api/orgs/[orgId]/businesses/[bizId]       # Delete business
POST   /api/business/detect                       # AI profile detection from URL
```

### Integrations
```
GET    /api/businesses/[bizId]/integrations                     # List integrations
POST   /api/businesses/[bizId]/integrations/google/connect      # Start OAuth
GET    /api/businesses/[bizId]/integrations/google/callback     # OAuth callback
DELETE /api/businesses/[bizId]/integrations/[id]                 # Disconnect
POST   /api/businesses/[bizId]/integrations/[id]/sync           # Manual sync trigger
```

### Reviews
```
GET    /api/businesses/[bizId]/reviews              # List reviews (paginated, filterable)
POST   /api/businesses/[bizId]/reviews              # Manual review input
PATCH  /api/businesses/[bizId]/reviews/[id]         # Update flags/sentiment
DELETE /api/businesses/[bizId]/reviews/[id]          # Delete review
```

### AI Replies
```
POST   /api/reviews/[reviewId]/generate             # Generate 3 reply options
PATCH  /api/replies/[replyId]                        # Edit reply content
POST   /api/replies/[replyId]/select                 # Mark as selected
POST   /api/replies/[replyId]/publish                # Publish to platform
```

### Sync (Background / Cron)
```
POST   /api/sync/run                # Cron endpoint: sync all due integrations
GET    /api/businesses/[bizId]/sync-log    # View sync history
```

### URL Pattern Philosophy
Routes are nested by ownership: `/orgs/[orgId]/businesses/[bizId]/reviews`. This makes authorization straightforward — middleware checks the user's membership for orgId before the handler runs. Business-scoped routes like `/businesses/[bizId]/...` can skip the org prefix since the business itself carries the org_id.


---

## 6. Frontend Workspace Pattern

The UI needs a workspace switcher. Here's how it works:

**On login:** Fetch memberships. Find the one where `is_default = true`. Load that org's businesses.

**Workspace context:** Store `currentOrgId` and `currentBizId` in a React context (or URL state like `/dashboard/[bizId]`). All API calls include these IDs.

**Switching org:** User selects a different org from dropdown → update context → reload businesses list.

**Switching business:** User picks a different business → update `currentBizId` → reload reviews/stats for that business.

**Key component structure:**
```
<WorkspaceProvider>          ← holds currentOrg, currentBiz
  <DashboardLayout>
    <OrgSwitcher />          ← dropdown top-left
    <BusinessSwitcher />     ← tabs or dropdown below nav
    <DashboardContent />     ← filtered by currentBiz
  </DashboardLayout>
</WorkspaceProvider>
```

Store the last-used org/biz in `localStorage` so it persists across sessions. This is better than relying on the `is_default` DB field for business selection since users switch frequently.


---

## 7. Google Business Profile Integration

### Setup Requirements
1. Google Cloud project with "My Business Account Management API" and "My Business Business Information API" enabled
2. OAuth 2.0 credentials (Web application type)
3. Redirect URI: `https://app.opinia.cat/api/businesses/[bizId]/integrations/google/callback`
4. Scopes needed: `https://www.googleapis.com/auth/business.manage`

### OAuth Flow
```
1. User clicks "Connect Google Reviews"
2. Redirect to Google consent screen with state = { biz_id, user_id }
3. User authorizes
4. Google redirects back with authorization code
5. Server exchanges code for tokens
6. Server calls Google API to list locations → user picks which one
7. Store: access_token, refresh_token, token_expires_at, account_id (location resource name)
```

### Sync Implementation
Use the Google Business Profile API v1 (`mybusinessbusinessinformation` for location data, direct review endpoints for reviews):

```typescript
// Pseudocode for review sync
async function syncGoogleReviews(integration: Integration) {
  // Refresh token if needed
  if (integration.token_expires_at < new Date()) {
    const tokens = await refreshGoogleToken(integration.refresh_token);
    await updateIntegration(integration.id, tokens);
  }

  // Fetch reviews with pagination
  let pageToken = integration.sync_cursor;
  do {
    const response = await fetch(
      `https://mybusiness.googleapis.com/v4/${integration.account_id}/reviews?pageSize=50&pageToken=${pageToken}`,
      { headers: { Authorization: `Bearer ${integration.access_token}` } }
    );
    const data = await response.json();

    for (const review of data.reviews) {
      // Upsert: INSERT ... ON CONFLICT (biz_id, source, external_id) DO UPDATE
      await upsertReview({
        biz_id: integration.biz_id,
        org_id: integration.org_id,
        source: 'google',
        external_id: review.reviewId,
        author_name: review.reviewer.displayName,
        review_text: review.comment || '',
        rating: starRatingToNumber(review.starRating),
        sentiment: ratingToSentiment(starRatingToNumber(review.starRating)),
        review_date: review.createTime,
        metadata: { profilePhotoUrl: review.reviewer.profilePhotoUrl },
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  // Save cursor for next incremental sync
  await updateIntegration(integration.id, { sync_cursor: null, last_sync_at: new Date() });
}
```

### Cron Setup (Vercel)
In `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/sync/run",
    "schedule": "*/15 * * * *"
  }]
}
```

The `/api/sync/run` endpoint is protected by checking `request.headers.get('Authorization') === 'Bearer ' + process.env.CRON_SECRET`.


---

## 8. Migration Path from v1

If you have existing data in the v1 schema, here's the migration strategy:

```sql
-- 1. The old organizations table maps directly to the new one
-- 2. Old profiles.org_id becomes a membership row
-- 3. Old settings rows become businesses rows
-- 4. Old reviews and replies get biz_id = the business created from settings

-- After running schema-v2.sql on a fresh DB, migrate data:

-- Step 1: Copy orgs
INSERT INTO organizations (id, name, created_at, updated_at)
SELECT id, name, created_at, updated_at FROM old_schema.organizations;

-- Step 2: Copy profiles (without org_id)
INSERT INTO profiles (id, full_name, avatar_url, created_at, updated_at)
SELECT id, full_name, avatar_url, created_at, updated_at FROM old_schema.profiles;

-- Step 3: Create memberships from old profiles.org_id
INSERT INTO memberships (user_id, org_id, role, is_default, accepted_at)
SELECT id, org_id, 'owner', true, now() FROM old_schema.profiles WHERE org_id IS NOT NULL;

-- Step 4: Convert settings → businesses
INSERT INTO businesses (id, org_id, name, type, url, tags, default_signature, formality, default_language, onboarding_done)
SELECT id, org_id, business_name, business_type::text::biz_type, business_url, tags, default_signature, formality::text::formality, default_language, onboarding_complete
FROM old_schema.settings;

-- Step 5: Copy reviews (add biz_id from the business we just created)
INSERT INTO reviews (id, biz_id, org_id, source, review_text, rating, sentiment, language_detected, created_at)
SELECT r.id, s.id, r.org_id, 'manual', r.review_text, r.rating, r.sentiment::text::sentiment, r.language_detected, r.created_at
FROM old_schema.reviews r
JOIN old_schema.settings s ON s.org_id = r.org_id;

-- Step 6: Copy replies (add biz_id)
INSERT INTO replies (id, review_id, biz_id, org_id, tone, content, status, is_edited, created_at)
SELECT rp.id, rp.review_id, b.id, rp.org_id, rp.tone::text::reply_tone, rp.content,
  CASE WHEN rp.is_selected THEN 'selected'::reply_status ELSE 'draft'::reply_status END,
  rp.is_edited, rp.created_at
FROM old_schema.replies rp
JOIN old_schema.settings s ON s.org_id = rp.org_id
JOIN businesses b ON b.id = s.id;
```

This is a one-time migration. After verifying data, drop the old tables.


---

## 9. Scaling & Monetization Readiness

### Plan Enforcement
The `organizations` table has `plan`, `max_businesses`, and `max_reviews_mo`. Enforce limits in API routes:

```typescript
// Before creating a business
const org = await getOrg(orgId);
const bizCount = await countBusinesses(orgId);
if (bizCount >= org.max_businesses) {
  return Response.json({ error: 'upgrade_required', limit: 'max_businesses' }, { status: 403 });
}

// Before generating AI replies
const monthlyUsage = await countRepliesThisMonth(orgId);
if (monthlyUsage >= org.max_reviews_mo) {
  return Response.json({ error: 'upgrade_required', limit: 'max_reviews_mo' }, { status: 403 });
}
```

### Suggested Plans
| Feature | Free | Starter (19€/mo) | Pro (49€/mo) | Enterprise |
|---------|------|-------------------|--------------|------------|
| Businesses | 1 | 3 | 10 | Unlimited |
| AI replies/month | 20 | 100 | 500 | Unlimited |
| Google sync | ❌ | ✅ | ✅ | ✅ |
| Team members | 1 | 3 | 10 | Unlimited |
| Reply publishing | ❌ | ❌ | ✅ | ✅ |
| Custom AI instructions | ❌ | ✅ | ✅ | ✅ |
| Priority support | ❌ | ❌ | ✅ | ✅ |

### Stripe Integration Points
- `organizations.stripe_customer_id` links to Stripe
- On plan change: update `plan`, `max_businesses`, `max_reviews_mo`
- Webhook endpoint: `POST /api/webhooks/stripe` handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

### Performance at Scale
- Partial indexes on `reviews` (`WHERE is_replied = false`, `WHERE needs_attention = true`) keep dashboard queries fast even with millions of rows
- `sync_cursor` on integrations enables incremental sync — you never re-fetch the full history
- `org_id` denormalized on all tables means RLS policies resolve with simple index lookups instead of multi-table joins
- For very high volume (10K+ reviews/day), move sync jobs to a dedicated worker (Supabase Edge Functions or a separate service) instead of Vercel Cron

### Observability
The `sync_log` table gives you full audit trail: when syncs ran, how many reviews were fetched, whether they succeeded or failed. Build a simple admin dashboard on top of this for monitoring.
