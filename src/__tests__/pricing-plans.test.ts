/**
 * PR-1 data contract tests.
 * Run: npx tsx src/__tests__/pricing-plans.test.ts
 */

import { FEATURES, getPrice, PLANS, SAVINGS_PERCENT, YEARLY_MONTHS_CHARGED } from '../lib/pricing/plans';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass += 1;
  else fail += 1;
}

console.log('\n=== PLANS ===');
assert('exactly 3 plans', PLANS.length === 3);
assert('contains starter', PLANS.some((plan) => plan.id === 'starter'));
assert('contains pro', PLANS.some((plan) => plan.id === 'pro'));
assert('contains agency', PLANS.some((plan) => plan.id === 'agency'));

const proPlan = PLANS.find((plan) => plan.id === 'pro');
assert('pro is recommended', !!proPlan && proPlan.recommended === true);

for (const plan of PLANS) {
  const price = getPrice(plan, 'yearly');
  assert(`${plan.id}: monthly price > 0`, plan.monthlyPriceCents > 0);
  assert(`${plan.id}: yearly uses 10 charged months`, plan.annualPriceCents === plan.monthlyPriceCents * YEARLY_MONTHS_CHARGED);
  assert(`${plan.id}: helper returns annual cents`, price.annualPriceCents === plan.annualPriceCents);
  assert(`${plan.id}: yearly savings percent is 17`, price.savingsPct === SAVINGS_PERCENT);
}

console.log('\n=== FEATURES MAP ===');
const featureIds = FEATURES.map((feature) => feature.id);
assert('feature catalog is not empty', featureIds.length > 0);

for (const plan of PLANS) {
  const mappedIds = Object.keys(plan.features).sort();
  const missing = featureIds.filter((id) => !mappedIds.includes(id));
  assert(`${plan.id}: has all feature ids`, missing.length === 0);
}

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
