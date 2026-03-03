/**
 * Unit tests: provider mapping for normalized review model.
 * Run: npx tsx src/__tests__/reviews-provider-mapping.test.ts
 */

import { mapGbpReviewRowToNormalizedReview } from '../lib/providers/google/google-reviews-provider';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass += 1;
  else fail += 1;
}

function run() {
  const normalized = mapGbpReviewRowToNormalizedReview({
    id: 'row-1',
    provider: 'google',
    provider_review_id: 'accounts/1/locations/2/reviews/abc',
    gbp_review_id: 'legacy-abc',
    rating: 5,
    text_snippet: 'Excellent stay',
    author: 'Maria',
    reply_status: 'pending',
    create_time: '2026-03-03T10:00:00.000Z',
    raw_ref: { review_name: 'accounts/1/locations/2/reviews/abc' },
  });

  assert('normalized provider is google_business', normalized.provider === 'google_business');
  assert('normalized provider_review_id uses explicit provider_review_id', normalized.provider_review_id === 'accounts/1/locations/2/reviews/abc');
  assert('normalized text is preserved', normalized.text === 'Excellent stay');
  assert('normalized raw_ref is serialized', normalized.raw_ref === '{"review_name":"accounts/1/locations/2/reviews/abc"}');

  const legacy = mapGbpReviewRowToNormalizedReview({
    id: 'row-2',
    gbp_review_id: 'legacy-only-id',
    star_rating: 4,
    comment_preview: 'Great breakfast',
    reviewer_label: 'Un client',
    has_reply: true,
    create_time: '2026-03-02T09:00:00.000Z',
  });

  assert('legacy fallback provider_review_id comes from gbp_review_id', legacy.provider_review_id === 'legacy-only-id');
  assert('legacy fallback rating comes from star_rating', legacy.rating === 4);
  assert('legacy fallback maps replied from has_reply', legacy.reply_status === 'replied');
  assert('legacy reviewer label "Un client" is anonymized to null', legacy.author_name === null);

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run();
