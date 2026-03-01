/**
 * Entitlements contract tests (D1 trial/paywall hardening follow-up).
 * Run: npx tsx src/__tests__/billing-entitlements.test.ts
 */

import {
  canUseLitoCopy,
  type OrgEntitlements,
  requireEntitlement,
} from '../lib/billing/entitlements';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass += 1;
  else fail += 1;
}

function baseEntitlements(): OrgEntitlements {
  return {
    org_id: '00000000-0000-0000-0000-000000000000',
    plan_code: 'starter',
    locations_limit: 1,
    seats_limit: 1,
    lito_drafts_limit: 15,
    signals_level: 'basic',
    staff_daily_limit: 10,
    staff_monthly_ratio_cap: 0.3,
  };
}

console.log('\n=== requireEntitlement(lito_copy) ===');
let threwLocked = false;
try {
  const disabled = { ...baseEntitlements(), lito_drafts_limit: 0 };
  requireEntitlement({ entitlements: disabled, feature: 'lito_copy' });
} catch (error) {
  const message = String((error as Error).message || '');
  threwLocked = message.includes('lito_copy_locked');
}
assert('lito_drafts_limit=0 -> feature locked', threwLocked);

let threwQuota = false;
try {
  requireEntitlement({
    entitlements: baseEntitlements(),
    feature: 'lito_copy',
    current: 14,
    amount: 5,
  });
} catch (error) {
  const message = String((error as Error).message || '');
  threwQuota = message.includes('lito_copy_quota_exceeded') || message.includes('quota_exceeded');
}
assert('lito_copy no longer throws quota_exceeded in entitlements layer', threwQuota === false);

console.log('\n=== canUseLitoCopy ===');
const paused = canUseLitoCopy({
  role: 'staff',
  pausedFlag: true,
  entitlements: baseEntitlements(),
});
assert('staff paused -> denied', paused.allowed === false && paused.reason === 'paused');

const enabled = canUseLitoCopy({
  role: 'manager',
  pausedFlag: false,
  entitlements: baseEntitlements(),
});
assert('enabled + not paused -> allowed', enabled.allowed === true);

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
