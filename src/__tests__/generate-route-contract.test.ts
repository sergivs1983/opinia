/**
 * Generate route contract tests.
 * Run: npx tsx src/__tests__/generate-route-contract.test.ts
 */

import {
  ReviewGenerateParamsSchema,
  ReviewGenerateBodySchema,
  resolveGenerateSeoStrategy,
} from '../lib/validations/schemas';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

console.log('\n=== 1) HAPPY PATH (payload mínim) ===');

const paramsOk = ReviewGenerateParamsSchema.safeParse({
  reviewId: '11111111-1111-4111-8111-111111111111',
});
assert('Params valid', paramsOk.success);

const bodyOk = ReviewGenerateBodySchema.safeParse({
  platform: 'google',
  rating: '4',
});
assert('Body minimal valid', bodyOk.success);
assert('Rating coerced to number', bodyOk.success && bodyOk.data.rating === 4);
assert('regenerate defaults to false', bodyOk.success && bodyOk.data.regenerate === false);

console.log('\n=== 2) INVALID PAYLOAD (missing/invalid rating/platform) ===');

const missingRating = ReviewGenerateBodySchema.safeParse({
  platform: 'google',
});
assert('Missing rating is invalid', !missingRating.success);

const invalidPlatform = ReviewGenerateBodySchema.safeParse({
  platform: 'facebook',
  rating: 5,
});
assert('Invalid platform enum is invalid', !invalidPlatform.success);

console.log('\n=== 3) NEGATIVE REVIEW -> SEO SECONDARY ===');

assert('Rating 1 resolves to secondary SEO strategy', resolveGenerateSeoStrategy(1) === 'secondary');
assert('Rating 5 resolves to primary SEO strategy', resolveGenerateSeoStrategy(5) === 'primary');

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
