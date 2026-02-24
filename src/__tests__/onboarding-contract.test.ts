/**
 * Onboarding (ONB-1) contract tests.
 * Run: npx tsx src/__tests__/onboarding-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  OnboardingPatchSchema,
  OnboardingSeedSchema,
} from '../lib/validations/schemas';

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

const patchHappy = OnboardingPatchSchema.safeParse({
  step: 3,
  completed: false,
});
assert('PATCH onboarding happy', patchHappy.success);

const patchInvalid = OnboardingPatchSchema.safeParse({});
assert('PATCH onboarding invalid empty body', !patchInvalid.success);

const patchInvalidStep = OnboardingPatchSchema.safeParse({
  step: 7,
});
assert('PATCH onboarding invalid step range', !patchInvalidStep.success);

const seedHappy = OnboardingSeedSchema.safeParse({
  businessId: '11111111-1111-4111-8111-111111111111',
  language: 'en',
  count: 5,
});
assert('SEED onboarding happy', seedHappy.success);

const seedInvalidCount = OnboardingSeedSchema.safeParse({
  businessId: '11111111-1111-4111-8111-111111111111',
  count: 50,
});
assert('SEED onboarding invalid count cap', !seedInvalidCount.success);

const seedInvalidBiz = OnboardingSeedSchema.safeParse({
  businessId: 'not-a-uuid',
  count: 5,
});
assert('SEED onboarding invalid businessId', !seedInvalidBiz.success);

console.log('\n=== ROUTE CONTRACT ===');

const onboardingRoute = read('src/app/api/onboarding/route.ts');
includes('GET onboarding enforces auth', onboardingRoute, "error: 'unauthorized'");
includes('GET onboarding requires workspace header', onboardingRoute, "Missing x-biz-id workspace header");
includes('GET onboarding resolves language', onboardingRoute, 'resolveOnboardingLanguage');
includes('GET onboarding computes state with helper', onboardingRoute, 'getOnboardingState(supabase, businessId)');
includes('GET onboarding returns state payload', onboardingRoute, '...state,');
includes('PATCH onboarding validates body', onboardingRoute, 'validateBody(request, OnboardingPatchSchema)');
includes('PATCH onboarding upserts onboarding_progress', onboardingRoute, "from('onboarding_progress')");
includes('PATCH onboarding updates last_seen_at', onboardingRoute, 'last_seen_at');
includes('Onboarding route sets x-request-id header', onboardingRoute, "response.headers.set('x-request-id', requestId)");

const seedRoute = read('src/app/api/onboarding/seed/route.ts');
includes('SEED validates body', seedRoute, 'validateBody(request, OnboardingSeedSchema)');
includes('SEED enforces workspace ownership', seedRoute, 'workspaceBusinessId && workspaceBusinessId !== payload.businessId');
includes('SEED idempotent check (existing reviews + force=false)', seedRoute, 'if (hasReviews && !payload.force)');
includes('SEED writes demo reviews', seedRoute, ".from('reviews')");
includes('SEED writes audit event', seedRoute, "action: 'ONBOARDING_DEMO_SEEDED'");
includes('SEED returns request_id', seedRoute, 'request_id: requestId');

console.log('\n=== HELPER CONTRACT ===');

const onboardingLib = read('src/lib/onboarding.ts');
includes('resolveOnboardingLanguage fallback to ca', onboardingLib, "return 'ca';");
includes('getOnboardingState checks reviews cheaply', onboardingLib, ".from('reviews')");
includes('getOnboardingState checks suggestions cheaply', onboardingLib, ".from('content_suggestions')");
includes('getOnboardingState checks assets cheaply', onboardingLib, ".from('content_assets')");
includes('getOnboardingState checks planner cheaply', onboardingLib, ".from('content_planner_items')");

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
