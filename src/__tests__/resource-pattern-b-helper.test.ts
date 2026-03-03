/**
 * Pattern B resource helper tests — requireResourceAccessPatternB(request, resourceId, table)
 * Run: npx tsx src/__tests__/resource-pattern-b-helper.test.ts
 */

import { NextResponse } from 'next/server';

import {
  requireResourceAccessPatternB,
  ResourceTable,
} from '../lib/api-handler';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

type MockResult = { data: Record<string, unknown> | null; error: null | { message: string; code?: string } };

function makeChain(result: MockResult) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const method of ['select', 'eq', 'neq', 'not', 'limit', 'order']) {
    chain[method] = () => chain;
  }
  chain.single = () => Promise.resolve(result);
  chain.maybeSingle = () => Promise.resolve(result);
  return chain;
}

function mockSupabase(tableMap: Record<string, MockResult>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => makeChain(tableMap[table] ?? { data: null, error: null }) } as any;
}

const USER_A = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';
const BIZ_A = 'bbbbbbb1-0000-4000-8000-000000000001';
const BIZ_B = 'bbbbbbb2-0000-4000-8000-000000000002';
const ORG_A = 'cccccccc-0000-4000-8000-000000000001';
const ORG_B = 'cccccccc-0000-4000-8000-000000000002';
const REVIEW_A = 'ddddddd1-0000-4000-8000-000000000001';
const REVIEW_B = 'ddddddd2-0000-4000-8000-000000000002';
const REVIEW_X = 'ddddddd3-0000-4000-8000-000000000003';

async function run() {
  console.log('\n=== Pattern B Resource Helper ===');

  let crossBody: unknown = null;
  let missingBody: unknown = null;

  {
    const req = new Request('http://localhost:3000/api/reviews/foo?biz_id=11111111-1111-4111-8111-111111111111', {
      headers: { 'x-biz-id': '22222222-2222-4222-8222-222222222222' },
    });
    const supabase = mockSupabase({
      reviews: { data: { id: REVIEW_A, biz_id: BIZ_A }, error: null },
      businesses: { data: { id: BIZ_A, org_id: ORG_A }, error: null },
      memberships: { data: { id: 'mem-1', role: 'owner' }, error: null },
    });

    const result = await requireResourceAccessPatternB(req, REVIEW_A, ResourceTable.Reviews, {
      supabase,
      user: { id: USER_A },
    });

    assert('Own resource => returns context (not NextResponse)', !(result instanceof NextResponse));
    if (!(result instanceof NextResponse)) {
      assert('Own resource => ok true', result.ok === true);
      assert('Own resource => bizId looked up from resource', result.bizId === BIZ_A);
      assert('Own resource => role propagated', result.role === 'owner');
    }
  }

  {
    const req = new Request(`http://localhost:3000/api/reviews/${REVIEW_B}?biz_id=${BIZ_A}`, {
      headers: { 'x-biz-id': BIZ_A },
    });
    const supabase = mockSupabase({
      reviews: { data: { id: REVIEW_B, biz_id: BIZ_B }, error: null },
      businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
      memberships: { data: null, error: null },
    });

    const result = await requireResourceAccessPatternB(req, REVIEW_B, ResourceTable.Reviews, {
      supabase,
      user: { id: USER_A },
    });

    assert('Cross-tenant resource => NextResponse', result instanceof NextResponse);
    if (result instanceof NextResponse) {
      assert('Cross-tenant resource => 404', result.status === 404);
      crossBody = await result.json();
    }
  }

  {
    const req = new Request(`http://localhost:3000/api/reviews/${REVIEW_X}?biz_id=${BIZ_A}`);
    const supabase = mockSupabase({
      reviews: { data: null, error: null },
    });

    const result = await requireResourceAccessPatternB(req, REVIEW_X, ResourceTable.Reviews, {
      supabase,
      user: { id: USER_A },
    });

    assert('Missing resource => NextResponse', result instanceof NextResponse);
    if (result instanceof NextResponse) {
      assert('Missing resource => 404', result.status === 404);
      missingBody = await result.json();
    }
  }

  assert(
    'Cross-tenant 404 and missing 404 are indistinguishable',
    JSON.stringify(crossBody) === JSON.stringify(missingBody),
  );

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
