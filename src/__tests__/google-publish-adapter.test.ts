/**
 * Google publish adapter tests.
 * Run: npx tsx src/__tests__/google-publish-adapter.test.ts
 */

import {
  GbpPermanentError,
  GbpTransientError,
  publishReplyToGoogle,
} from '@/lib/integrations/google/publish';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

async function run() {
  console.log('\n=== GOOGLE PUBLISH ADAPTER ===');

  const originalFetch = globalThis.fetch;

  try {
    await publishReplyToGoogle({
      accessToken: 'tok',
      externalReviewId: 'review-only-id',
      replyText: 'Hola',
    });
    assert('invalid external review id should throw', false);
  } catch (error) {
    assert(
      'invalid external review id => permanent',
      error instanceof GbpPermanentError && error.code === 'review_external_id_invalid',
    );
  }

  globalThis.fetch = (async () => new Response(JSON.stringify({
    reviewReply: { updateTime: '2026-03-03T10:00:00Z' },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;

  const success = await publishReplyToGoogle({
    accessToken: 'tok',
    externalReviewId: 'accounts/1/locations/2/reviews/3',
    replyText: 'Gràcies per la visita',
  });
  assert('success path returns reply marker', success.gbpReplyId === '2026-03-03T10:00:00Z');

  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: { status: 'RESOURCE_EXHAUSTED', message: 'Too many requests' },
  }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;

  try {
    await publishReplyToGoogle({
      accessToken: 'tok',
      externalReviewId: 'accounts/1/locations/2/reviews/3',
      replyText: 'retry',
    });
    assert('429 should throw transient', false);
  } catch (error) {
    assert(
      '429 => transient',
      error instanceof GbpTransientError && error.code === 'RESOURCE_EXHAUSTED',
    );
  }

  globalThis.fetch = originalFetch;

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run().finally(() => {
  // no-op cleanup for tsx standalone runs
});
