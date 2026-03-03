/**
 * D1.3 contract tests: Google reviews sync + Inbox MVP.
 * Run: npx tsx src/__tests__/reviews-sync-inbox-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextResponse } from 'next/server';

import { requireBizAccessPatternB } from '../lib/api-handler';
import { listGoogleReviews } from '../lib/integrations/google/reviews';

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

function gateBeforeFirstQuery(label: string, content: string, handlerAnchor: string, gatePattern: string, queryPattern: string) {
  const handlerIdx = content.indexOf(handlerAnchor);
  const slice = handlerIdx >= 0 ? content.slice(handlerIdx) : content;
  const gateIdx = slice.indexOf(gatePattern);
  const firstQueryIdx = slice.indexOf(queryPattern);
  assert(label, gateIdx >= 0 && firstQueryIdx >= 0 && gateIdx < firstQueryIdx);
}

const USER_A = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';
const BIZ_A = 'bbbbbbb1-0000-4000-8000-000000000001';
const BIZ_B = 'bbbbbbb2-0000-4000-8000-000000000002';
const ORG_A = 'cccccccc-0000-4000-8000-000000000001';
const ORG_B = 'cccccccc-0000-4000-8000-000000000002';

async function run() {
  console.log('\n=== CROSS-TENANT PATTERN B ===');

  {
    const req = new Request(`http://localhost:3000/api/reviews?biz_id=${BIZ_B}`, {
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

    assert('GET /api/reviews cross-tenant => 404', denied instanceof NextResponse && denied.status === 404);
  }

  {
    const req = new Request(`http://localhost:3000/api/reviews/sync?biz_id=${BIZ_B}`, {
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

    assert('POST /api/reviews/sync cross-tenant => 404', denied instanceof NextResponse && denied.status === 404);
  }

  console.log('\n=== IDEMPOTENCE / DEDUPE ===');

  {
    const originalFetch = globalThis.fetch;
    let pageCalls = 0;

    globalThis.fetch = (async () => {
      pageCalls += 1;

      if (pageCalls === 1) {
        return new Response(JSON.stringify({
          reviews: [{
            name: 'accounts/11/locations/22/reviews/rr-1',
            reviewId: 'rr-1',
            starRating: 'FIVE',
            comment: 'Great stay!',
            createTime: '2026-03-01T10:00:00Z',
          }],
          nextPageToken: 'page-2',
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        reviews: [{
          name: 'accounts/11/locations/22/reviews/rr-1',
          reviewId: 'rr-1',
          starRating: 'FIVE',
          comment: 'Great stay!',
          createTime: '2026-03-01T10:00:00Z',
        }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const listed = await listGoogleReviews({
        accessToken: 'test-token',
        locationResources: ['accounts/11/locations/22'],
        pageSize: 50,
        maxPages: 2,
      });

      assert('Google reviews list succeeds', listed.ok === true);
      if (listed.ok) {
        assert('duplicate provider_review_id merged (idempotent input)', listed.reviews.length === 1);
        assert('fetched reflects deduped set', listed.fetched === 1);
      }
      assert('pagination called multiple pages', pageCalls === 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  console.log('\n=== ROUTE CONTRACT ===');

  const root = path.resolve(__dirname, '..', '..');
  const listRoute = fs.readFileSync(path.join(root, 'src/app/api/reviews/route.ts'), 'utf8');
  const syncRoute = fs.readFileSync(path.join(root, 'src/app/api/reviews/sync/route.ts'), 'utf8');
  const internalSyncRoute = fs.readFileSync(path.join(root, 'src/app/api/_internal/gbp/reviews/sync/route.ts'), 'utf8');
  const providerImpl = fs.readFileSync(path.join(root, 'src/lib/providers/google/google-reviews-provider.ts'), 'utf8');

  gateBeforeFirstQuery(
    'GET /api/reviews: gate before first DB query',
    listRoute,
    'export async function GET',
    'requireBizAccessPatternB(request, bizId',
    'createGoogleReviewsProvider({ supabase, log })',
  );

  assert(
    'GET /api/reviews: list route uses provider boundary',
    listRoute.includes('provider.listReviews(access.bizId'),
  );
  assert(
    'Provider listReviews: list scoped by guarded biz',
    providerImpl.includes(".eq('biz_id', bizId)"),
  );
  assert(
    'Provider listReviews: cursor pagination present',
    providerImpl.includes(".lt('create_time', cursorIso)") && providerImpl.includes('.limit(safeLimit + 1)'),
  );

  assert(
    'POST /api/reviews/sync: uses Pattern B gate',
    syncRoute.includes('requireBizAccessPatternB(request, bizId'),
  );
  assert(
    'POST /api/reviews/sync: staff denied as 404',
    syncRoute.includes("access.role !== 'owner' && access.role !== 'manager'")
      && syncRoute.includes('status: 404'),
  );

  assert(
    'Internal sync route: uses provider boundary',
    internalSyncRoute.includes('provider.syncReviews(bizId)'),
  );

  assert(
    'Provider sync: upsert idempotent by provider review key',
    providerImpl.includes("onConflict: 'biz_id,provider,provider_review_id'"),
  );

  assert(
    'Provider sync: writes provider/review normalized columns',
    providerImpl.includes('provider_review_id: review.providerReviewId')
      && providerImpl.includes('reply_status: review.replyStatus')
      && providerImpl.includes('raw_ref: review.rawRef'),
  );

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
