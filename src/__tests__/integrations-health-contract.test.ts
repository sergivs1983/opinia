/**
 * D1.3.5 contract: integrations health endpoint + sync health mapping.
 * Run: npx tsx src/__tests__/integrations-health-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextResponse } from 'next/server';

import { requireBizAccessPatternB } from '../lib/api-handler';
import { deriveFailureHealthUpdate } from '../lib/providers/google/google-reviews-provider';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass += 1;
  else fail += 1;
}

type MockResult = { data: Record<string, unknown> | null; error: null | { message: string; code?: string } };

function makeChain(nextResult: () => MockResult) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const method of ['select', 'eq', 'neq', 'not', 'limit', 'order']) {
    chain[method] = () => chain;
  }
  chain.single = () => Promise.resolve(nextResult());
  chain.maybeSingle = () => Promise.resolve(nextResult());
  return chain;
}

function mockSupabase(tableMap: Record<string, MockResult | MockResult[]>) {
  const queues = Object.fromEntries(
    Object.entries(tableMap).map(([table, result]) => [table, Array.isArray(result) ? [...result] : [result]]),
  ) as Record<string, MockResult[]>;

  const fallback: MockResult = { data: null, error: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    from: (table: string) => makeChain(() => {
      const queue = queues[table];
      if (!queue || queue.length === 0) return fallback;
      if (queue.length === 1) return queue[0];
      const next = queue.shift();
      return next || fallback;
    }),
  } as any;
}

const USER_A = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbb2-0000-4000-8000-000000000002';
const ORG_B = 'cccccccc-0000-4000-8000-000000000002';

async function run() {
  console.log('\n=== CROSS-TENANT PATTERN B ===');

  {
    const req = new Request(`http://localhost:3000/api/integrations/health?biz_id=${BIZ_B}`, {
      headers: { 'x-biz-id': BIZ_B },
    });

    const denied = await requireBizAccessPatternB(req, BIZ_B, {
      supabase: mockSupabase({
        businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
        memberships: { data: null, error: null },
      }),
      user: { id: USER_A },
      queryBizId: BIZ_B,
      headerBizId: BIZ_B,
    });

    assert('GET /api/integrations/health cross-tenant => 404', denied instanceof NextResponse && denied.status === 404);
  }

  console.log('\n=== HEALTH MAPPING ===');

  {
    const mapped = deriveFailureHealthUpdate({
      httpStatus: 401,
      errorCode: 'invalid_grant',
      errorMessage: 'refresh token revoked',
    });
    assert('401 invalid_grant => needs_reauth status', mapped.status === 'needs_reauth');
    assert('401 invalid_grant => needs_reauth flag true', mapped.setNeedsReauth === true);
    assert('401 invalid_grant => increments failure counter', mapped.incrementFailures === true);
  }

  {
    const mapped = deriveFailureHealthUpdate({
      httpStatus: 429,
      errorCode: null,
      errorMessage: 'quota exceeded',
    });
    assert('429 => generic error status', mapped.status === 'error');
    assert('429 => mapped to rate_limited code', mapped.errorCode === 'rate_limited');
  }

  console.log('\n=== ROUTE CONTRACT ===');

  const root = path.resolve(__dirname, '..', '..');
  const healthRoute = fs.readFileSync(path.join(root, 'src/app/api/integrations/health/route.ts'), 'utf8');
  const providerImpl = fs.readFileSync(path.join(root, 'src/lib/providers/google/google-reviews-provider.ts'), 'utf8');

  assert(
    'GET /api/integrations/health: uses Pattern B gate',
    healthRoute.includes('requireBizAccessPatternB(request, bizId'),
  );

  assert(
    'GET /api/integrations/health: tenant-scoped integrations query',
    healthRoute.includes(".eq('biz_id', access.bizId)"),
  );

  assert(
    'Sync provider: updates integration health fields',
    providerImpl.includes('last_sync_status')
      && providerImpl.includes('last_error_detail')
      && providerImpl.includes('consecutive_failures')
      && providerImpl.includes('needs_reauth'),
  );

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
