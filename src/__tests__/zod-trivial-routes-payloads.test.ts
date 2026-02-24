/**
 * Zod payload tests for Sprint 1 trivial routes.
 * Run: npx tsx src/__tests__/zod-trivial-routes-payloads.test.ts
 */

import {
  DLQActionSchema,
  JobRunSchema,
  DemoSeedSchema,
  DemoGenerateSchema,
  ReviewAuditSchema,
  CompetitorCreateSchema,
  ProfileDetectSchema,
} from '../lib/validations/schemas';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

function expectValid(label: string, schema: { safeParse: (value: unknown) => { success: boolean } }, payload: unknown) {
  const result = schema.safeParse(payload);
  assert(label, result.success);
}

function expectInvalid(label: string, schema: { safeParse: (value: unknown) => { success: boolean } }, payload: unknown) {
  const result = schema.safeParse(payload);
  assert(label, !result.success);
}

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const BIZ_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';

console.log('\n=== DLQ ===');
expectValid('DLQ happy', DLQActionSchema, { action: 'retry', failed_job_id: JOB_ID });
expectInvalid('DLQ invalid', DLQActionSchema, { action: 'retry' });

console.log('\n=== JOBS ===');
expectValid('Jobs happy', JobRunSchema, { job: 'rebuild_insights', biz_id: BIZ_ID, org_id: ORG_ID });
expectInvalid('Jobs invalid', JobRunSchema, { job: 'rebuild_insights', biz_id: BIZ_ID });

console.log('\n=== DEMO-SEED ===');
expectValid('Demo-seed happy', DemoSeedSchema, { biz_id: BIZ_ID, org_id: ORG_ID });
expectInvalid('Demo-seed invalid', DemoSeedSchema, { biz_id: 'bad-id', org_id: ORG_ID });

console.log('\n=== DEMO-GENERATE ===');
expectValid(
  'Demo-generate happy',
  DemoGenerateSchema,
  { review_text: 'Aquest hotel està molt bé i tornarem segur.', rating: 5, language: 'ca' }
);
expectInvalid(
  'Demo-generate invalid',
  DemoGenerateSchema,
  { review_text: 'curt', rating: 5 }
);

console.log('\n=== REVIEW-AUDIT ===');
expectValid(
  'Review-audit happy',
  ReviewAuditSchema,
  {
    business_name: 'Hotel Sol',
    reviews: [{ text: 'Servei correcte però lent a recepció.', rating: 3 }],
  }
);
expectInvalid(
  'Review-audit invalid',
  ReviewAuditSchema,
  { business_name: 'Hotel Sol', reviews: [] }
);

console.log('\n=== COMPETITORS ===');
expectValid(
  'Competitors happy',
  CompetitorCreateSchema,
  { biz_id: BIZ_ID, org_id: ORG_ID, name: 'Competidor X', public_url: 'https://example.com' }
);
expectInvalid(
  'Competitors invalid',
  CompetitorCreateSchema,
  { biz_id: BIZ_ID, org_id: ORG_ID }
);

console.log('\n=== PROFILE-DETECT ===');
expectValid('Profile-detect happy', ProfileDetectSchema, { url: 'example.com' });
expectInvalid('Profile-detect invalid', ProfileDetectSchema, { url: '' });

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
