/**
 * Pattern B helper tests — requireBizAccessPatternB(request, bizId)
 * Run: npx tsx src/__tests__/biz-pattern-b-helper.test.ts
 */

import { NextResponse } from 'next/server';

import { requireBizAccessPatternB } from '../lib/api-handler';

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

async function run() {
  console.log('\n=== Pattern B Helper ===');

  {
    const req = new Request(`http://localhost:3000/api/demo?biz_id=${BIZ_A}`, {
      headers: { 'x-biz-id': BIZ_A },
    });
    const supabase = mockSupabase({
      businesses: { data: { id: BIZ_A, org_id: ORG_A }, error: null },
      memberships: { data: { id: 'mem-1', role: 'owner' }, error: null },
    });

    const result = await requireBizAccessPatternB(req, BIZ_A, {
      supabase,
      user: { id: USER_A },
      bodyBizId: BIZ_A,
    });

    assert('Own biz => returns context (not NextResponse)', !(result instanceof NextResponse));
    if (!(result instanceof NextResponse)) {
      assert('Own biz => ok true', result.ok === true);
      assert('Own biz => returns normalized bizId', result.bizId === BIZ_A);
      assert('Own biz => returns userId', result.userId === USER_A);
      assert('Own biz => returns role', result.role === 'owner');
      assert('Own biz => returns org membership context', result.membership.orgId === ORG_A);
    }
  }

  let crossBody: unknown = null;
  let missingBody: unknown = null;

  {
    const req = new Request(`http://localhost:3000/api/demo?biz_id=${BIZ_B}`, {
      headers: { 'x-biz-id': BIZ_B },
    });
    const supabase = mockSupabase({
      businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
      memberships: { data: null, error: null },
    });

    const result = await requireBizAccessPatternB(req, BIZ_B, {
      supabase,
      user: { id: USER_A },
      bodyBizId: BIZ_B,
    });

    assert('Cross-tenant => NextResponse', result instanceof NextResponse);
    if (result instanceof NextResponse) {
      assert('Cross-tenant => ok false', (result as NextResponse & { ok?: boolean }).ok === false);
      assert('Cross-tenant => 404', result.status === 404);
      crossBody = await result.json();
    }
  }

  {
    const req = new Request(`http://localhost:3000/api/demo?biz_id=${BIZ_B}`, {
      headers: { 'x-biz-id': BIZ_B },
    });
    const supabase = mockSupabase({
      businesses: { data: null, error: null },
    });

    const result = await requireBizAccessPatternB(req, BIZ_B, {
      supabase,
      user: { id: USER_A },
      bodyBizId: BIZ_B,
    });

    assert('Non-existent biz => NextResponse', result instanceof NextResponse);
    if (result instanceof NextResponse) {
      assert('Non-existent biz => ok false', (result as NextResponse & { ok?: boolean }).ok === false);
      assert('Non-existent biz => 404', result.status === 404);
      missingBody = await result.json();
    }
  }

  assert(
    'Cross-tenant 404 and non-existent 404 are indistinguishable',
    JSON.stringify(crossBody) === JSON.stringify(missingBody),
  );

  {
    const req = new Request(`http://localhost:3000/api/demo?biz_id=${BIZ_A}`, {
      headers: { 'x-biz-id': BIZ_B },
    });
    const supabase = mockSupabase({
      businesses: { data: { id: BIZ_A, org_id: ORG_A }, error: null },
      memberships: { data: { id: 'mem-1', role: 'owner' }, error: null },
    });

    const result = await requireBizAccessPatternB(req, BIZ_A, {
      supabase,
      user: { id: USER_A },
      bodyBizId: BIZ_A,
    });

    assert('Ambiguous biz_id sources => 404', result instanceof NextResponse && result.status === 404);
  }

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
