/**
 * Biz Guard tests — requireBizAccess (src/lib/api-handler.ts)
 *
 * Contracte verificat:
 *   UUID malformat  → 400 bad_request
 *   biz no existeix → 404 not_found   (orgId === null de hasAcceptedBusinessMembership)
 *   biz existeix,     403 forbidden   (orgId !== null, no membership)
 *     sense accés  →
 *   accés concedit  → null            (handler continua)
 *
 * Run: npx tsx src/__tests__/biz-guard.test.ts
 * O via: npm test (executa tots els __tests__)
 */

import { requireBizAccess } from '../lib/api-handler';

// ── Helpers ───────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

// ── Minimal chainable Supabase mock ──────────────────────────────────────────
// Simula: .from(table).select(...).eq(...).eq(...).not(...).limit(n).single/maybeSingle()
type MockResult = { data: Record<string, unknown> | null; error: null | { message: string } };

function makeChain(result: MockResult) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ['select', 'eq', 'neq', 'not', 'limit', 'order']) {
    chain[m] = () => chain;
  }
  chain.single     = () => Promise.resolve(result);
  chain.maybeSingle = () => Promise.resolve(result);
  return chain;
}

function mockSupabase(tableMap: Record<string, MockResult>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => makeChain(tableMap[table] ?? { data: null, error: null }) } as any;
}

// ── Constants (UUIDs sintètics, cap PII) ──────────────────────────────────────
const USER_A = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';
const BIZ_A  = 'bbbbbbb1-0000-4000-8000-000000000001'; // biz de user A
const BIZ_B  = 'bbbbbbb2-0000-4000-8000-000000000002'; // biz d'un altre tenant
const ORG_A  = 'cccccccc-0000-4000-8000-000000000001';
const ORG_B  = 'cccccccc-0000-4000-8000-000000000002';

// ─────────────────────────────────────────────────────────────────────────────
async function run() {

  // ── 1) UUID VALIDATION → 400 ─────────────────────────────────────────────
  console.log('\n=== 1) UUID VALIDATION → 400 ===');

  const r1a = await requireBizAccess({ supabase: mockSupabase({}), userId: USER_A, bizId: null });
  assert('null bizId → 400',         r1a !== null && r1a.status === 400);

  const r1b = await requireBizAccess({ supabase: mockSupabase({}), userId: USER_A, bizId: 'not-a-uuid' });
  assert('random string → 400',      r1b !== null && r1b.status === 400);

  const r1c = await requireBizAccess({ supabase: mockSupabase({}), userId: USER_A, bizId: '1234-abcd' });
  assert('truncated UUID → 400',     r1c !== null && r1c.status === 400);

  const r1d_body = await r1a!.json();
  assert('400 error code = bad_request', r1d_body.error === 'bad_request');

  // ── 2) BIZ NOT FOUND → 404 ───────────────────────────────────────────────
  // businesses retorna null → hasAcceptedBusinessMembership retorna orgId: null → 404
  console.log('\n=== 2) BIZ NOT FOUND → 404 ===');

  {
    const supabase = mockSupabase({
      businesses: { data: null, error: null }, // biz inexistent
    });
    const res = await requireBizAccess({ supabase, userId: USER_A, bizId: BIZ_B });
    assert('biz not found → 404',              res !== null && res.status === 404);
    const body = await res!.json();
    assert('biz not found → error: not_found', body.error === 'not_found');
  }

  // ── 3) BIZ EXISTEIX, USER SENSE ACCÉS → 403 ──────────────────────────────
  // businesses retorna dades → orgId = ORG_B, però memberships = null → 403
  console.log('\n=== 3) CROSS-TENANT (biz existeix, sense accés) → 403 ===');

  {
    const supabase = mockSupabase({
      businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
      memberships: { data: null, error: null }, // user A no és membre de ORG_B
    });
    const res = await requireBizAccess({ supabase, userId: USER_A, bizId: BIZ_B });
    assert('cross-tenant → 403 (no 404)',      res !== null && res.status === 403);
    const body = await res!.json();
    assert('cross-tenant → error: forbidden',  body.error === 'forbidden');
  }

  // ── 4) ACCÉS VÀLID (owner) → null ────────────────────────────────────────
  console.log('\n=== 4) ACCÉS VÀLID: owner → null ===');

  {
    const supabase = mockSupabase({
      businesses: { data: { id: BIZ_A, org_id: ORG_A }, error: null },
      memberships: { data: { id: 'mem-1', role: 'owner' }, error: null },
    });
    const res = await requireBizAccess({ supabase, userId: USER_A, bizId: BIZ_A });
    assert('owner → null (accés concedit)',    res === null);
  }

  // ── 5) MEMBRE ORG sense assignació biz → 403 ─────────────────────────────
  // orgId !== null (biz existeix), però business_memberships = null → 403
  console.log('\n=== 5) MEMBRE ORG sense assignació biz → 403 ===');

  {
    const supabase = mockSupabase({
      businesses:           { data: { id: BIZ_A, org_id: ORG_A }, error: null },
      memberships:          { data: { id: 'mem-1', role: 'member' }, error: null }, // non-admin
      business_memberships: { data: null, error: null },                             // sense assignació
    });
    const res = await requireBizAccess({ supabase, userId: USER_A, bizId: BIZ_A });
    assert('org member sense biz assignment → 403', res !== null && res.status === 403);
  }

  // ── 6) DISTINCIÓ 404 vs 403 (anti-enumeració selectiva) ──────────────────
  // 404 quan el biz no existeix, 403 quan existeix però no tens accés.
  // L'atacant sap que el biz existeix si rep 403 — aquest és el trade-off
  // acceptat per millor UX/debuggability en un sistema B2B autenticat.
  console.log('\n=== 6) DISTINCIÓ 404 (no existeix) vs 403 (existeix, sense accés) ===');

  {
    const notFoundSupabase = mockSupabase({ businesses: { data: null, error: null } });
    const forbiddenSupabase = mockSupabase({
      businesses: { data: { id: BIZ_B, org_id: ORG_B }, error: null },
      memberships: { data: null, error: null },
    });

    const notFoundRes  = await requireBizAccess({ supabase: notFoundSupabase,  userId: USER_A, bizId: BIZ_B });
    const forbiddenRes = await requireBizAccess({ supabase: forbiddenSupabase, userId: USER_A, bizId: BIZ_B });

    assert('not_found → 404',                  notFoundRes  !== null && notFoundRes.status  === 404);
    assert('forbidden → 403',                  forbiddenRes !== null && forbiddenRes.status === 403);
    assert('404 ≠ 403 (distingits)',           notFoundRes!.status !== forbiddenRes!.status);
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
