# Security Notes

## npm audit — current status (2026-02-24)

`npm audit` reports **14 high-severity advisories** (28 affected package
entries, but they collapse to 14 distinct advisories).  None are exploitable
in our deployment context.  See details below.

---

### 1. Next.js — GHSA-f82v-jwr5-mffw / GHSA-3h5q-q6xp-mxc4
**Reported range:** 10.0.0 – 15.5.9
**Our version:** 14.2.35 (latest 14.x patch)
**Fix suggested by npm:** upgrade to Next.js 16.x (semver major → breaking changes)

#### Why we stay on 14.2.35
A major-version bump to Next.js 16 would require significant migration work
(App Router API changes, dependency upgrades across the board) with high risk
of regressions.  The business decision is to remain on 14.2.35 until a
planned upgrade sprint.

#### Mitigation applied (config-level)
The published CVEs target the **Next.js Image Optimization API**
(`/_next/image`), which acts as a server-side proxy for remote images.  If
`remotePatterns` is too permissive, an attacker can craft a URL that causes
the server to fetch arbitrary external hosts (SSRF) or traverse paths.

We have **completely closed this vector** by setting `remotePatterns: []` in
`next.config.js`.  This means:

* The `/_next/image` endpoint will **refuse every remote URL** with a 400
  response.
* The only images processed by the optimizer are **local static files**
  (currently `/brand/logo.png`).
* All external images (Supabase Storage signed URLs, Google profile photos)
  are rendered with plain `<img>` tags and bypass the optimizer entirely.
  This is intentional: Supabase signed URLs carry expiring tokens that would
  cause constant cache misses in the optimizer anyway.

#### Re-check trigger
Re-evaluate this decision when Next.js 15.6+ (or a future 14.x patch) covers
the full advisory range without a major-version upgrade.

---

### 2. ESLint ecosystem (eslint@8, eslint-config-next@14, related plugins)
**Reported range:** various, all fixable by upgrading to ESLint 10
**Our version:** eslint@8.57.0
**Fix suggested by npm:** upgrade to eslint@10 + eslint-config-next 0.2.4 (major)

#### Why we stay on ESLint 8
ESLint 9/10 dropped the legacy `.eslintrc.*` config format in favour of
`eslint.config.js`.  Migrating requires rewriting all config and updating
every plugin.  Planned for the same upgrade sprint as Next.js 16.

#### Impact
ESLint is a **development-only** tool — it runs in CI and developer machines,
never on production servers or user devices.  The reported advisories are
about ESLint's own internal modules (e.g. `flat-cache`, `glob`, `minimatch`)
and carry **no runtime risk** to end users.

---

### 3. Summary table

| Advisory | Package | Severity | Vector | Mitigated? |
|---|---|---|---|---|
| GHSA-f82v-jwr5-mffw | next | high | SSRF via /_next/image | ✅ remotePatterns: [] |
| GHSA-3h5q-q6xp-mxc4 | next | high | Path traversal via /_next/image | ✅ remotePatterns: [] |
| various | eslint ecosystem | high | Dev-only tool, no production exposure | ✅ accepted risk |

---

### Planned upgrades

- [ ] Next.js 16.x migration (planned, no fixed date)
- [ ] ESLint 10 + flat config migration (same sprint)

---

## service_role usage audit (2026-02-25)

`createAdminClient()` (`src/lib/supabase/admin.ts`) uses
`SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS by default.

### Files that call createAdminClient / use service_role

| File | Reason |
|------|--------|
| `src/app/(auth)/callback/route.ts` | Auth callback — sets up user profile |
| `src/app/api/billing/route.ts` | Billing webhooks — no user session |
| `src/app/api/bootstrap/route.ts` | Org/business provisioning |
| `src/app/api/businesses/[id]/brand-image/route.ts` | Storage signed URLs |
| `src/app/api/businesses/[id]/brand-image/signed-url/route.ts` | Storage ops |
| `src/app/api/content-studio/assets/[id]/signed-url/route.ts` | Storage ops |
| `src/app/api/content-studio/render/route.ts` | Rendering pipeline |
| `src/app/api/demo-generate/route.ts` | Demo seed (dev only) |
| `src/app/api/demo-seed/route.ts` | Demo seed (dev only) |
| `src/app/api/dlq/route.ts` | Dead-letter queue processing |
| `src/app/api/exports/[id]/signed-url/route.ts` | Export download URLs |
| `src/app/api/exports/weekly/route.ts` | Cron-triggered exports |
| `src/app/api/g/[slug]/route.ts` | Public growth-link lookup |
| `src/app/api/growth-links/route.ts` | Growth link management |
| `src/app/api/health/route.ts` | Healthcheck (read-only probe) |
| `src/app/api/integrations/connectors/route.ts` | Connector config |
| `src/app/api/jobs/route.ts` | Background job runner |
| `src/app/api/metrics/summary/route.ts` | Metrics aggregation |
| `src/app/api/orgs/[orgId]/set-plan/route.ts` | Plan upgrade (billing) |
| `src/app/api/review-audit/route.ts` | Audit pipeline |
| `src/app/api/seo/capabilities/route.ts` | SEO processing |
| `src/app/api/webhooks/config/route.ts` | Webhook config management |
| `src/app/api/workspace/active-org/route.ts` | Workspace switcher |
| `src/lib/audit.ts` | Audit log writer |
| `src/lib/integrations/dispatch.ts` | Integration event dispatch |
| `src/lib/jobs/runner.ts` | Job runner (no user session) |
| `src/lib/llm/circuitBreaker.ts` | LLM circuit breaker |
| `src/lib/llm/client.ts` | LLM API client |
| `src/lib/metrics.ts` | Metrics upsert |
| `src/lib/metrics-value.ts` | Metrics helpers |
| `src/lib/pipeline/classify.ts` | AI classification pipeline |
| `src/lib/pipeline/context.ts` | Pipeline context builder |
| `src/lib/pipeline/orchestrator.ts` | Pipeline orchestrator |
| `src/lib/server/tokens.ts` | Token management |
| `src/lib/webhooks.ts` | Webhook delivery |

### Risk assessment

All usages are in **server-side code** (Next.js API routes and server libs)
where the `SUPABASE_SERVICE_ROLE_KEY` is never exposed to the client.
The uses fall into three categories:

1. **Legitimate RLS bypass** — background jobs, cron tasks, pipeline steps
   that write on behalf of the system, not a specific user. These have no
   user session and cannot use a JWT-scoped client.

2. **Storage operations** — generating signed URLs requires service-level
   access to storage buckets; Supabase does not support row-level scoping
   for `storage.objects` in the same way as data tables.

3. **Auth/bootstrap flows** — setting up user profiles and org provisioning
   after Supabase Auth callback, before the user has a full session.

### Action items (Bloc 7) — completed / deferred

**Bloc 7 implemented:**
- [x] `src/lib/supabase/admin.ts`: exports `getAdminClient()` (renamed from
      `createAdminClient`); single source of truth for service_role client.
- [x] `src/lib/security/service-role.ts`: `assertServiceRoleAllowed(req)`
      runtime guard — returns 403 if called from non-allowlisted path.
- [x] `scripts/check-service-role.mjs`: static deny-by-default check; exits 1
      if any non-allowlisted file imports `admin.ts`; exits 0 with warnings for
      DEFERRED items.
- [x] 11 lib files converted to dependency injection (no direct admin import).
- [x] 11 user-facing routes switched from admin to user Supabase client.
- [x] Allowlisted routes (`webhooks/config`, `jobs`) use `getAdminClient()` +
      `assertServiceRoleAllowed` guard.
- [x] `bootstrap` moved to `src/app/api/_internal/bootstrap/route.ts`; old
      path forwards for backward compat.

**DEFERRED (Bloc 8) — audited, documented, no new violations allowed:**

| File | Reason admin is needed | Bloc 8 action |
|------|------------------------|---------------|
| `src/app/(auth)/callback/route.ts` | Supabase Auth redirect URL constraint; user has no membership yet (chicken-and-egg) | Add special RLS policy allowing auth callback writes, OR move to _internal after updating Supabase dashboard config |
| `src/app/api/g/[slug]/route.ts` | Public short link — no user JWT, can't use user client with current RLS | Add anon SELECT policy to `growth_links` for active links (separate migration) |
| `src/app/api/dlq/route.ts` | DLQ retry (POST) writes to `failed_jobs`; admin bypasses RLS for system writes | Move POST handler to `_internal/dlq-retry/` |
| `src/app/api/orgs/[orgId]/set-plan/route.ts` | Billing plan update modifies org-level data bypassing RLS | Move to `_internal/orgs/set-plan/` |
| `src/app/api/content-studio/render/route.ts` | Render pipeline reads cross-tenant data for rendering | Refactor to accept user supabase + proper RLS |
| `src/lib/server/tokens.ts` | `integrations_secrets` is deny-all RLS by design; service_role required | Called only from allowlisted integration routes after Bloc 8 refactor |

- [ ] Rotate `SUPABASE_SERVICE_ROLE_KEY` in Vercel env if it has ever been
      committed or logged.
