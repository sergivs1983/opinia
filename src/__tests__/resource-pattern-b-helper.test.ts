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
    Object.entries(tableMap).map(([table, result]) => [
      table,
      Array.isArray(result) ? [...result] : [result],
    ]),
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
const BIZ_A = 'bbbbbbb1-0000-4000-8000-000000000001';
const BIZ_B = 'bbbbbbb2-0000-4000-8000-000000000002';
const ORG_A = 'cccccccc-0000-4000-8000-000000000001';
const ORG_B = 'cccccccc-0000-4000-8000-000000000002';
const REVIEW_A = 'ddddddd1-0000-4000-8000-000000000001';
const REVIEW_B = 'ddddddd2-0000-4000-8000-000000000002';
const REVIEW_X = 'ddddddd3-0000-4000-8000-000000000003';
const RESOURCE_A = 'eeeeeee1-0000-4000-8000-000000000001';
const RESOURCE_B = 'eeeeeee2-0000-4000-8000-000000000002';
const RESOURCE_X = 'eeeeeee3-0000-4000-8000-000000000003';

type ResourceMatrixCase = {
  name: string;
  table: ResourceTable;
  ownMap: Record<string, MockResult | MockResult[]>;
  crossMap: Record<string, MockResult | MockResult[]>;
  missingMap: Record<string, MockResult | MockResult[]>;
};

async function assertResourceMatrix(test: ResourceMatrixCase) {
  let crossBody: unknown = null;
  let missingBody: unknown = null;

  {
    const req = new Request(`http://localhost:3000/api/resource/${RESOURCE_A}?biz_id=${BIZ_A}`, {
      headers: { 'x-biz-id': BIZ_A },
    });
    const result = await requireResourceAccessPatternB(req, RESOURCE_A, test.table, {
      supabase: mockSupabase(test.ownMap),
      user: { id: USER_A },
    });

    assert(`${test.name}: own resource => context`, !(result instanceof NextResponse));
    if (!(result instanceof NextResponse)) {
      assert(`${test.name}: own resource => ok true`, result.ok === true);
      assert(`${test.name}: own resource => bizId`, result.bizId === BIZ_A);
    }
  }

  {
    const req = new Request(`http://localhost:3000/api/resource/${RESOURCE_B}?biz_id=${BIZ_B}`, {
      headers: { 'x-biz-id': BIZ_B },
    });
    const result = await requireResourceAccessPatternB(req, RESOURCE_B, test.table, {
      supabase: mockSupabase(test.crossMap),
      user: { id: USER_A },
    });

    assert(`${test.name}: cross-tenant => NextResponse`, result instanceof NextResponse);
    if (result instanceof NextResponse) {
      assert(`${test.name}: cross-tenant => 404`, result.status === 404);
      crossBody = await result.json();
    }
  }

  {
    const req = new Request(`http://localhost:3000/api/resource/${RESOURCE_X}?biz_id=${BIZ_A}`, {
      headers: { 'x-biz-id': BIZ_A },
    });
    const result = await requireResourceAccessPatternB(req, RESOURCE_X, test.table, {
      supabase: mockSupabase(test.missingMap),
      user: { id: USER_A },
    });

    assert(`${test.name}: missing => NextResponse`, result instanceof NextResponse);
    if (result instanceof NextResponse) {
      assert(`${test.name}: missing => 404`, result.status === 404);
      missingBody = await result.json();
    }
  }

  assert(
    `${test.name}: cross-tenant 404 indistinguishable from missing 404`,
    JSON.stringify(crossBody) === JSON.stringify(missingBody),
  );
}

async function run() {
  console.log('\n=== Pattern B Resource Helper ===');

  let crossBody: unknown = null;
  let missingBody: unknown = null;

  {
    const req = new Request(`http://localhost:3000/api/reviews/${REVIEW_A}?biz_id=${BIZ_A}`, {
      headers: { 'x-biz-id': BIZ_A },
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
    const req = new Request(`http://localhost:3000/api/reviews/${REVIEW_B}?biz_id=${BIZ_B}`, {
      headers: { 'x-biz-id': BIZ_B },
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

  const matrixCases: ResourceMatrixCase[] = [
    {
      name: 'Connectors',
      table: ResourceTable.Connectors,
      ownMap: {
        connectors: { data: { id: RESOURCE_A, business_id: BIZ_A }, error: null },
        businesses: { data: { id: BIZ_A, org_id: ORG_A }, error: null },
        memberships: { data: { id: 'mem-own', role: 'owner' }, error: null },
      },
      crossMap: {
        connectors: { data: { id: RESOURCE_B, business_id: BIZ_B }, error: null },
        businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
        memberships: { data: null, error: null },
      },
      missingMap: {
        connectors: { data: null, error: null },
      },
    },
    {
      name: 'LitoThreads',
      table: ResourceTable.LitoThreads,
      ownMap: {
        lito_threads: { data: { id: RESOURCE_A, biz_id: BIZ_A }, error: null },
        businesses: { data: { id: BIZ_A, org_id: ORG_A }, error: null },
        memberships: { data: { id: 'mem-own', role: 'owner' }, error: null },
      },
      crossMap: {
        lito_threads: { data: { id: RESOURCE_B, biz_id: BIZ_B }, error: null },
        businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
        memberships: { data: null, error: null },
      },
      missingMap: {
        lito_threads: { data: null, error: null },
      },
    },
    {
      name: 'PlannerItems',
      table: ResourceTable.PlannerItems,
      ownMap: {
        content_planner_items: { data: { id: RESOURCE_A, business_id: BIZ_A }, error: null },
        businesses: { data: { id: BIZ_A, org_id: ORG_A }, error: null },
        memberships: { data: { id: 'mem-own', role: 'owner' }, error: null },
      },
      crossMap: {
        content_planner_items: { data: { id: RESOURCE_B, business_id: BIZ_B }, error: null },
        businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
        memberships: { data: null, error: null },
      },
      missingMap: {
        content_planner_items: { data: null, error: null },
      },
    },
    {
      name: 'RecommendationLog',
      table: ResourceTable.RecommendationLog,
      ownMap: {
        recommendation_log: { data: { id: RESOURCE_A, biz_id: BIZ_A }, error: null },
        businesses: { data: { id: BIZ_A, org_id: ORG_A }, error: null },
        memberships: { data: { id: 'mem-own', role: 'owner' }, error: null },
      },
      crossMap: {
        recommendation_log: { data: { id: RESOURCE_B, biz_id: BIZ_B }, error: null },
        businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
        memberships: { data: null, error: null },
      },
      missingMap: {
        recommendation_log: { data: null, error: null },
      },
    },
    {
      name: 'Replies',
      table: ResourceTable.Replies,
      ownMap: {
        replies: { data: { id: RESOURCE_A, biz_id: BIZ_A }, error: null },
        businesses: { data: { id: BIZ_A, org_id: ORG_A }, error: null },
        memberships: { data: { id: 'mem-own', role: 'owner' }, error: null },
      },
      crossMap: {
        replies: { data: { id: RESOURCE_B, biz_id: BIZ_B }, error: null },
        businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
        memberships: { data: null, error: null },
      },
      missingMap: {
        replies: { data: null, error: null },
      },
    },
    {
      name: 'SocialSchedules',
      table: ResourceTable.SocialSchedules,
      ownMap: {
        social_schedules: { data: { id: RESOURCE_A, biz_id: BIZ_A }, error: null },
        businesses: { data: { id: BIZ_A, org_id: ORG_A }, error: null },
        memberships: { data: { id: 'mem-own', role: 'owner' }, error: null },
      },
      crossMap: {
        social_schedules: { data: { id: RESOURCE_B, biz_id: BIZ_B }, error: null },
        businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
        memberships: { data: null, error: null },
      },
      missingMap: {
        social_schedules: { data: null, error: null },
      },
    },
    {
      name: 'Memberships',
      table: ResourceTable.Memberships,
      ownMap: {
        memberships: [
          { data: { org_id: ORG_A }, error: null },
          { data: { id: 'mem-own', role: 'owner' }, error: null },
        ],
        businesses: [
          { data: { id: BIZ_A }, error: null },
          { data: { id: BIZ_A, org_id: ORG_A }, error: null },
        ],
      },
      crossMap: {
        memberships: [
          { data: { org_id: ORG_B }, error: null },
          { data: null, error: null },
        ],
        businesses: [
          { data: { id: BIZ_B }, error: null },
          { data: { id: BIZ_B, org_id: ORG_B }, error: null },
        ],
      },
      missingMap: {
        memberships: { data: null, error: null },
      },
    },
  ];

  for (const matrixCase of matrixCases) {
    await assertResourceMatrix(matrixCase);
  }

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
