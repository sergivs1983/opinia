/**
 * Planner (PL-1) contract tests.
 * Run: npx tsx src/__tests__/planner-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  PlannerCreateSchema,
  PlannerItemParamsSchema,
  PlannerListQuerySchema,
  PlannerPatchSchema,
} from '../lib/validations/schemas';
import {
  deriveScheduledAtFromBestTime,
  plannerChannelFromSuggestionType,
} from '../lib/planner';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

function includes(label: string, haystack: string, needle: string) {
  assert(label, haystack.includes(needle));
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

console.log('\n=== SCHEMAS ===');

const happySuggestion = PlannerCreateSchema.safeParse({
  businessId: '11111111-1111-4111-8111-111111111111',
  weekStart: '2026-02-16',
  scheduledAt: deriveScheduledAtFromBestTime({
    weekStart: '2026-02-16',
    bestTime: 'Thu 7:30 PM',
  }),
  channel: plannerChannelFromSuggestionType('reel'),
  itemType: 'suggestion',
  suggestionId: '22222222-2222-4222-8222-222222222222',
  title: 'Fast check-in highlight',
});
assert('POST planner happy (suggestion)', happySuggestion.success);

const invalidMissingSuggestion = PlannerCreateSchema.safeParse({
  businessId: '11111111-1111-4111-8111-111111111111',
  weekStart: '2026-02-16',
  scheduledAt: '2026-02-19T19:30:00.000Z',
  channel: 'ig_reel',
  itemType: 'suggestion',
  title: 'Missing suggestion id',
});
assert('POST planner invalid when suggestionId missing', !invalidMissingSuggestion.success);

const listQueryHappy = PlannerListQuerySchema.safeParse({
  weekStart: '2026-02-16',
  channel: 'ig_feed',
  status: 'planned',
  limit: '50',
});
assert('GET planner query happy path', listQueryHappy.success);

const listQueryInvalid = PlannerListQuerySchema.safeParse({
  weekStart: '16-02-2026',
  limit: 999,
});
assert('GET planner query invalid path', !listQueryInvalid.success);

const patchParamsHappy = PlannerItemParamsSchema.safeParse({
  id: '33333333-3333-4333-8333-333333333333',
});
assert('PATCH params happy path', patchParamsHappy.success);

const patchHappy = PlannerPatchSchema.safeParse({
  status: 'published',
});
assert('PATCH planner publish status happy', patchHappy.success);

const patchInvalid = PlannerPatchSchema.safeParse({});
assert('PATCH planner invalid empty body', !patchInvalid.success);

console.log('\n=== ROUTE CONTRACT ===');

const plannerRoute = read('src/app/api/planner/route.ts');
includes('Planner GET validates query', plannerRoute, 'validateQuery(request, PlannerListQuerySchema)');
includes('Planner GET filters by week', plannerRoute, ".eq('week_start', normalizeWeekStartMonday(payload.weekStart))");
includes('Planner GET returns list with weekStart', plannerRoute, 'NextResponse.json({ weekStart: normalizeWeekStartMonday(payload.weekStart), items, request_id: requestId })');
includes('Planner POST validates body', plannerRoute, 'validateBody(request, PlannerCreateSchema)');
includes('Planner POST dedup by scheduled_at + channel + title', plannerRoute, ".eq('scheduled_at', scheduledAt)");
includes('Planner POST inserts into content_planner_items', plannerRoute, "from('content_planner_items')");
includes('Planner POST returns existing on dedup', plannerRoute, 'deduped: true');

const plannerPatchRoute = read('src/app/api/planner/[id]/route.ts');
includes('Planner PATCH validates params', plannerPatchRoute, 'validateParams(params, PlannerItemParamsSchema)');
includes('Planner PATCH validates body', plannerPatchRoute, 'validateBody(request, PlannerPatchSchema)');
includes('Planner PATCH updates row', plannerPatchRoute, ".from('content_planner_items')");
includes('Planner PATCH returns updated item', plannerPatchRoute, 'NextResponse.json({ item: updatedItem, request_id: requestId })');

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
