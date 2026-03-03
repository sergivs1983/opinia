/**
 * Publish domain helper tests.
 * Run: npx tsx src/__tests__/publish-domain.test.ts
 */

import {
  buildDraftExecutionPublishIdempotencyKey,
  buildReplyPublishIdempotencyKey,
  isActivePublishJobStatus,
  normalizeReplyContent,
  parsePublishJobStatus,
  parseReplyStatus,
  truncatePublishErrorDetail,
} from '@/lib/publish/domain';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

function run() {
  console.log('\n=== PUBLISH DOMAIN HELPERS ===');

  assert('parseReplyStatus(draft)', parseReplyStatus('draft') === 'draft');
  assert('parseReplyStatus(invalid)', parseReplyStatus('unknown') === null);

  assert('parsePublishJobStatus(success)', parsePublishJobStatus('success') === 'success');
  assert('parsePublishJobStatus(invalid)', parsePublishJobStatus('pending') === null);

  assert('active status queued', isActivePublishJobStatus('queued') === true);
  assert('active status failed false', isActivePublishJobStatus('failed') === false);

  assert('normalizeReplyContent trims', normalizeReplyContent('  Hola   món  ') === 'Hola món');
  assert('normalizeReplyContent empty => null', normalizeReplyContent('   ') === null);

  assert(
    'truncatePublishErrorDetail max len',
    (truncatePublishErrorDetail('x'.repeat(400), 300) || '').length === 300,
  );
  assert(
    'truncatePublishErrorDetail redacts Bearer token',
    truncatePublishErrorDetail('Bearer abc.def.ghi', 300) === 'Bearer [REDACTED]',
  );
  const redactedTokens = truncatePublishErrorDetail('access_token=abc123 refresh_token=def456', 300) || '';
  assert('truncatePublishErrorDetail redacts token key-value pairs', !redactedTokens.includes('abc123') && !redactedTokens.includes('def456'));

  const key = buildReplyPublishIdempotencyKey({
    replyId: 'r-1',
    updatedAtIso: '2026-03-03T00:00:00.000Z',
  });
  assert('reply idempotency format', key === 'reply:r-1:2026-03-03T00:00:00.000Z');

  const hashA = buildDraftExecutionPublishIdempotencyKey({
    draftId: 'd-1',
    reviewId: 'rev-1',
    replyContent: 'Bon dia',
  });
  const hashB = buildDraftExecutionPublishIdempotencyKey({
    draftId: 'd-1',
    reviewId: 'rev-1',
    replyContent: 'Bon dia',
  });
  const hashC = buildDraftExecutionPublishIdempotencyKey({
    draftId: 'd-1',
    reviewId: 'rev-1',
    replyContent: 'Bona tarda',
  });

  assert('hash deterministic', hashA === hashB);
  assert('hash changes with payload', hashA !== hashC);

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run();
