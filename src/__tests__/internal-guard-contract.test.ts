/**
 * Internal guard contract tests
 * Run: npx tsx src/__tests__/internal-guard-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { requireInternalGuard } from '@/lib/internal-guard';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass += 1;
  else fail += 1;
}

function statusForSecretRequest(headers: Record<string, string>): number {
  const req = new Request('http://localhost/api/cron/signals-run', {
    method: 'POST',
    headers,
  });
  const blocked = requireInternalGuard(req, {
    requestId: 'test-req',
    mode: 'secret',
  });
  return blocked?.status ?? 200;
}

function runHelperCases() {
  const previousSecret = process.env.INTERNAL_SECRET;
  const previousCronSecret = process.env.CRON_SECRET;

  process.env.INTERNAL_SECRET = 'test-internal-secret';
  process.env.CRON_SECRET = 'test-internal-secret';

  const nowTs = Date.now().toString();
  const staleTs = (Date.now() - 10 * 60 * 1000).toString();

  const missingHeaders = statusForSecretRequest({});
  assert('internal guard: missing headers => 401/403', missingHeaders === 401 || missingHeaders === 403);

  const staleTimestamp = statusForSecretRequest({
    'x-internal-secret': 'test-internal-secret',
    'x-timestamp': staleTs,
  });
  assert('internal guard: secret ok + stale timestamp => 401/403', staleTimestamp === 401 || staleTimestamp === 403);

  const freshTimestamp = statusForSecretRequest({
    'x-internal-secret': 'test-internal-secret',
    'x-timestamp': nowTs,
  });
  assert('internal guard: secret ok + fresh timestamp => 200', freshTimestamp === 200);

  const nonce = `nonce-${Date.now()}`;
  const firstNonceCall = statusForSecretRequest({
    'x-internal-secret': 'test-internal-secret',
    'x-timestamp': nowTs,
    'x-nonce': nonce,
  });
  const replayNonceCall = statusForSecretRequest({
    'x-internal-secret': 'test-internal-secret',
    'x-timestamp': nowTs,
    'x-nonce': nonce,
  });
  assert('internal guard: first nonce call => 200', firstNonceCall === 200);
  assert('internal guard: replay nonce => 401/403', replayNonceCall === 401 || replayNonceCall === 403);

  if (previousSecret === undefined) delete process.env.INTERNAL_SECRET;
  else process.env.INTERNAL_SECRET = previousSecret;
  if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousCronSecret;
}

function runRouteCoverageCases() {
  const internalRoutes = [
    '/api/_internal/bootstrap',
    '/api/_internal/gbp/reviews/sync',
    '/api/_internal/insights/rollup',
    '/api/_internal/lito/rebuild-cards',
    '/api/_internal/rules/run',
    '/api/_internal/signals/backfill',
    '/api/_internal/signals/run',
    '/api/_internal/signals/to-weekly',
    '/api/_internal/social/reminders/run',
    '/api/_internal/voice/purge',
    '/api/cron/audit-cleanup',
    '/api/cron/audit-probe',
    '/api/cron/gbp-reviews-sync',
    '/api/cron/signals-run',
    '/api/cron/worker/google/publish',
    '/api/jobs',
    '/api/stripe/webhook',
  ];

  const root = path.resolve(__dirname, '..', '..');
  const methodPattern = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
  const dbMarkers = [
    ".from('",
    ".rpc('",
    'createAdminClient(',
    'getAdminClient(',
  ];

  for (const route of internalRoutes) {
    const filePath = path.join(root, 'src/app', route.replace(/^\/api\//, 'api/'), 'route.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    assert(`${route}: uses requireInternalGuard`, content.includes('requireInternalGuard('));

    const handlers: Array<{ method: string; start: number; end: number }> = [];
    const matches = Array.from(content.matchAll(methodPattern));
    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      const start = match.index ?? -1;
      if (start < 0) continue;
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? content.length) : content.length;
      handlers.push({ method: match[1], start, end });
    }

    for (const handler of handlers) {
      const segment = content.slice(handler.start, handler.end);
      const guardIdx = segment.indexOf('requireInternalGuard(');
      const dbIdxCandidates = dbMarkers
        .map((marker) => segment.indexOf(marker))
        .filter((idx) => idx >= 0);
      if (dbIdxCandidates.length === 0) continue;

      const firstDbIdx = Math.min(...dbIdxCandidates);
      assert(
        `${route} [${handler.method}]: guard before first DB/RPC`,
        guardIdx >= 0 && guardIdx < firstDbIdx,
      );
    }
  }
}

function run() {
  console.log('\n=== INTERNAL GUARD HELPER ===');
  runHelperCases();

  console.log('\n=== INTERNAL ROUTE COVERAGE ===');
  runRouteCoverageCases();

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run();
