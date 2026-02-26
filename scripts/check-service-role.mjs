#!/usr/bin/env node
/**
 * check-service-role.mjs — Static analysis: detect admin client usage outside allowlist.
 *
 * Fails (exit 1) if:
 *   - SUPABASE_SERVICE_ROLE_KEY literal appears outside admin.ts
 *   - Import of @/lib/supabase/admin (or getAdminClient) appears outside allowlist
 *
 * Allowlist (server-to-server only):
 *   src/lib/supabase/admin.ts
 *   src/app/api/webhooks/**
 *   src/app/api/jobs/**
 *   src/app/api/_internal/**
 *
 * Deferred (audited, Bloc 8):
 *   src/app/(auth)/callback/route.ts   — auth provisioning, Supabase redirect URL constraint
 *   src/app/api/g/[slug]/route.ts      — public short link, needs anon RLS policy (no user JWT)
 *   src/app/api/dlq/route.ts           — DLQ retry needs service_role; move to _internal Bloc 8
 *   src/app/api/orgs/[orgId]/set-plan/route.ts — billing plan; move to _internal Bloc 8
 *   src/app/api/content-studio/render/route.ts — render pipeline; refactor Bloc 8
 *   src/lib/server/tokens.ts           — integrations_secrets deny-all; tokens layer Bloc 8
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname;

const ALLOWED = [
  'lib/supabase/admin.ts',
  'lib/security/service-role.ts',
  'app/api/webhooks/',
  'app/api/jobs/',
  'app/api/_internal/',
];

// These have been audited. They produce WARNINGs, not errors.
// Each must have a documented reason. Remove when Bloc 8 fixes them.
const DEFERRED = new Set([
  'app/(auth)/callback/route.ts',
  'app/api/g/[slug]/route.ts',
  'app/api/dlq/route.ts',
  'app/api/orgs/[orgId]/set-plan/route.ts',
  'app/api/content-studio/render/route.ts',
  'lib/server/tokens.ts',
]);

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '__tests__']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* walk(full);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      yield full;
    }
  }
}

function isAllowed(rel) {
  return ALLOWED.some((prefix) => rel === prefix || rel.startsWith(prefix));
}

function isDeferred(rel) {
  // normalise [param] paths
  const normalised = rel.replace(/\[.*?\]/g, '[slug]');
  return DEFERRED.has(rel) || DEFERRED.has(normalised);
}

const PATTERNS = [
  { re: /SUPABASE_SERVICE_ROLE_KEY/, label: 'SUPABASE_SERVICE_ROLE_KEY literal' },
  { re: /from\s+['"](?:@\/lib\/supabase\/admin|\.\.?\/.*supabase\/admin)['"]/, label: 'import from supabase/admin' },
  { re: /\bgetAdminClient\s*\(/, label: 'getAdminClient() call' },
];

let errors = 0;
let warnings = 0;

const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (isAllowed(rel)) continue;

  const content = readFileSync(file, 'utf8');
  for (const { re, label } of PATTERNS) {
    if (re.test(content)) {
      if (isDeferred(rel)) {
        console.log(yellow(`  ⚠ DEFERRED  ${rel}  [${label}]  — audited, Bloc 8`));
        warnings++;
      } else {
        console.log(red(`  ✗ VIOLATION  ${rel}  [${label}]`));
        errors++;
      }
      break; // one report per file
    }
  }
}

console.log('');
if (errors > 0) {
  console.log(red(`check:service-role FAILED — ${errors} violation(s), ${warnings} deferred`));
  process.exit(1);
} else if (warnings > 0) {
  console.log(yellow(`check:service-role PASSED with ${warnings} deferred (Bloc 8) — 0 new violations`));
  process.exit(0);
} else {
  console.log(green('check:service-role PASSED — 0 violations'));
  process.exit(0);
}
