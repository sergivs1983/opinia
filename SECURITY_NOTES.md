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
