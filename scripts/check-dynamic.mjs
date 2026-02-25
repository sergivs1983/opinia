#!/usr/bin/env node
/**
 * check-dynamic.mjs
 *
 * Rules:
 *   - Every authenticated page.tsx  → must have  dynamic = 'force-dynamic'
 *   - Every authenticated route.ts  → must have  dynamic = 'force-dynamic'
 *                                    AND  revalidate = 0
 *
 * Why the split?
 *   In Next.js 14, `export const revalidate = 0` inside a `'use client'`
 *   page causes a static-generation error ("Invalid revalidate value
 *   '[object Object]'"). Client-component pages only need `force-dynamic`
 *   to prevent caching; API routes (always server-side) need both.
 *
 * Public allowlist (skipped intentionally):
 *   src/app/api/health/route.ts   — public health probe
 *   src/app/api/g/[slug]/route.ts — public redirect tracker (no auth)
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC  = join(ROOT, 'src', 'app');

// ── Allowlist (relative to ROOT) ─────────────────────────────────────────────
const ALLOWLIST = new Set([
  'src/app/api/health/route.ts',
  'src/app/api/g/[slug]/route.ts',
]);

// ── Walk directory ────────────────────────────────────────────────────────────
function walk(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, results);
    } else if (entry === 'page.tsx' || entry === 'route.ts') {
      results.push(full);
    }
  }
  return results;
}

// ── Collect scoped files ──────────────────────────────────────────────────────
const dashboardFiles = walk(join(SRC, 'dashboard'));
const apiFiles       = walk(join(SRC, 'api'));
const allFiles       = [...dashboardFiles, ...apiFiles];

// ── Check each file ───────────────────────────────────────────────────────────
let failures = 0;

for (const abs of allFiles) {
  const rel = relative(ROOT, abs);

  if (ALLOWLIST.has(rel)) continue;

  const src          = readFileSync(abs, 'utf8');
  const isRoute      = abs.endsWith('route.ts');
  const hasDynamic   = /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(src);
  const hasRevalidate = /export\s+const\s+revalidate\s*=\s*0/.test(src);

  // Pages  → only dynamic required (revalidate in 'use client' pages breaks Next.js 14)
  // Routes → both dynamic AND revalidate required
  const missing = [];
  if (!hasDynamic) missing.push("dynamic = 'force-dynamic'");
  if (isRoute && !hasRevalidate) missing.push('revalidate = 0');

  if (missing.length > 0) {
    console.error(`FAIL  ${rel}  (missing: ${missing.join(', ')})`);
    failures++;
  }
}

// ── Result ────────────────────────────────────────────────────────────────────
const total = allFiles.length - ALLOWLIST.size;
if (failures === 0) {
  console.log(`PASS  ${total} authenticated route(s) — all have required cache-busting exports`);
  process.exit(0);
} else {
  console.error(`\n${failures} file(s) failed. Add the missing exports to each file above.`);
  process.exit(1);
}
