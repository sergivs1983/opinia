/**
 * Content Studio (CS-1) tests.
 * Run: npx tsx src/__tests__/content-studio.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ContentStudioAssetParamsSchema,
  ContentStudioAssetsListQuerySchema,
  ContentStudioRenderSchema,
  ContentStudioXGenerateSchema,
} from '../lib/validations/schemas';
import {
  buildStudioRenderPayload,
  buildStoragePaths,
  generateStudioTextVariants,
  renderStudioPng,
  type StudioLanguage,
} from '../lib/content-studio';

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

async function run() {
  console.log('\n=== SCHEMAS ===');

  const renderHappy = ContentStudioRenderSchema.safeParse({
    suggestionId: '11111111-1111-4111-8111-111111111111',
    format: 'story',
    templateId: 'quote-clean',
    language: 'en',
    brand: {
      primary: '#123456',
      secondary: '#abcdef',
      text: '#111111',
    },
  });
  assert('Render schema happy path', renderHappy.success);

  const renderFromAssetHappy = ContentStudioRenderSchema.safeParse({
    sourceAssetId: '11111111-1111-4111-8111-111111111112',
    format: 'feed',
    templateId: 'feature-split',
    language: 'ca',
  });
  assert('Render schema supports sourceAssetId', renderFromAssetHappy.success);

  const renderInvalid = ContentStudioRenderSchema.safeParse({
    suggestionId: undefined,
    format: 'poster',
    templateId: 'unknown-template',
    brand: {
      primary: 'blue',
    },
  });
  assert('Render schema invalid path', !renderInvalid.success);

  const xHappy = ContentStudioXGenerateSchema.safeParse({
    suggestionId: '22222222-2222-4222-8222-222222222222',
    platform: 'x',
    language: 'ca',
    tone: 'friendly',
  });
  assert('X-generate schema happy path', xHappy.success);

  const xInvalid = ContentStudioXGenerateSchema.safeParse({
    suggestionId: 'bad-uuid',
    platform: 'instagram',
    tone: 'aggressive',
  });
  assert('X-generate schema invalid path', !xInvalid.success);

  const listQueryHappy = ContentStudioAssetsListQuerySchema.safeParse({
    weekStart: '2026-02-16',
    format: 'story',
    language: 'en',
    templateId: 'quote-clean',
    status: 'created',
    limit: 30,
    cursor: '2026-02-20T10:00:00.000Z|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  assert('Assets list schema happy path', listQueryHappy.success);

  const listQueryInvalid = ContentStudioAssetsListQuerySchema.safeParse({
    weekStart: '2026/02/16',
    format: 'video',
    limit: 999,
  });
  assert('Assets list schema invalid path', !listQueryInvalid.success);

  const signedParamsHappy = ContentStudioAssetParamsSchema.safeParse({
    id: '33333333-3333-4333-8333-333333333333',
  });
  assert('Signed-url params schema happy path', signedParamsHappy.success);

  console.log('\n=== RENDER PNG ===');

  const renderPayload = buildStudioRenderPayload({
    suggestion: {
      title: 'Fast check-in',
      hook: 'How we keep arrivals smooth.',
      caption: 'A quick look at our reception workflow.',
      cta: 'Book this week',
      best_time: 'Thu 7:30 PM',
      shot_list: ['Entrance', 'Welcome desk', 'Room handoff'],
      hashtags: ['#hotel', '#experience'],
      evidence: [{ review_id: 'r1', quote: 'Super fast check-in and very friendly team.' }],
    },
    business: {
      name: 'Hotel Test',
      default_language: 'en' as StudioLanguage,
    },
    language: 'en',
    format: 'story',
    templateId: 'quote-clean',
  });

  const renderResult = await renderStudioPng(renderPayload);
  assert('Render returns non-empty png base64', renderResult.pngBase64.length > 40);
  assert('Render output looks like PNG base64', renderResult.pngBase64.startsWith('iVBOR'));
  assert('Render returns PNG bytes', renderResult.pngBuffer.byteLength > 0);
  assert('Render width is story width', renderResult.width === 1080);
  assert('Render height is story height', renderResult.height === 1920);

  const storagePaths = buildStoragePaths({
    businessId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    format: 'story',
    templateId: 'quote-clean',
    now: new Date('2026-02-20T00:00:00.000Z'),
  });
  assert('Storage path uses bucket prefix', storagePaths.storagePath.startsWith('content-assets/'));
  assert('Storage object path has business segment', storagePaths.objectPath.startsWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/'));

  console.log('\n=== X VARIANTS ===');

  const xVariants = generateStudioTextVariants({
    platform: 'x',
    language: 'en',
    tone: 'friendly',
    suggestion: {
      title: 'Fast check-in',
      hook: 'How we keep arrivals smooth.',
      caption: 'A quick look at our reception workflow.',
      cta: 'Book this week',
      best_time: 'Thu 7:30 PM',
      shot_list: [],
      hashtags: ['#hotel', '#experience'],
      evidence: [{ review_id: 'r1', quote: 'Super fast check-in and very friendly team.' }],
    },
    differentiators: ['fast check-in'],
  });

  assert('X variants returns exactly 3 items', xVariants.length === 3);
  assert('X variants max <= 240 chars', xVariants.every((variant) => variant.length <= 240));

  const threadVariants = generateStudioTextVariants({
    platform: 'threads',
    language: 'en',
    tone: 'professional',
    suggestion: {
      title: 'Fast check-in',
      hook: 'How we keep arrivals smooth.',
      caption: 'A quick look at our reception workflow.',
      cta: 'Book this week',
      best_time: 'Thu 7:30 PM',
      shot_list: [],
      hashtags: ['#hotel', '#experience'],
      evidence: [{ review_id: 'r1', quote: 'Super fast check-in and very friendly team.' }],
    },
    differentiators: ['fast check-in'],
  });

  assert('Threads variants max <= 320 chars', threadVariants.every((variant) => variant.length <= 320));

  console.log('\n=== ROUTE CONTRACT ===');

  const renderRoute = read('src/app/api/content-studio/render/route.ts');
  includes('Render route uses validateBody', renderRoute, 'validateBody(request, ContentStudioRenderSchema)');
  includes('Render route supports sourceAssetId', renderRoute, 'payload.sourceAssetId');
  includes('Render route inserts into content_assets', renderRoute, "from('content_assets')");
  includes('Render route uploads to storage', renderRoute, '.upload(objectPath, renderResult.pngBuffer');
  includes('Render route returns assetId', renderRoute, 'assetId: savedAsset.id');
  includes('Render route returns signedUrl', renderRoute, 'signedUrl: signedData.signedUrl');
  includes('Render route stores bytes metadata', renderRoute, 'bytes: renderResult.pngBuffer.byteLength');
  includes('Render route sets x-request-id', renderRoute, "response.headers.set('x-request-id', requestId)");

  const xRoute = read('src/app/api/content-studio/x-generate/route.ts');
  includes('X route uses validateBody', xRoute, 'validateBody(request, ContentStudioXGenerateSchema)');
  includes('X route generates variants', xRoute, 'generateStudioTextVariants');
  includes('X route returns variants', xRoute, 'NextResponse.json({ variants, request_id: requestId })');
  includes('X route sets x-request-id', xRoute, "response.headers.set('x-request-id', requestId)");

  const assetsRoute = read('src/app/api/content-studio/assets/route.ts');
  includes('Assets list uses validateQuery', assetsRoute, 'validateQuery(request, ContentStudioAssetsListQuerySchema)');
  includes('Assets list filters by format', assetsRoute, "assetsQuery = assetsQuery.eq('format', payload.format)");
  includes('Assets list filters by language', assetsRoute, "assetsQuery = assetsQuery.eq('language', payload.language)");
  includes('Assets list supports week filter', assetsRoute, "assetsQuery = assetsQuery.gte('created_at', from).lt('created_at', to)");
  includes('Assets list supports pagination cursor', assetsRoute, "assetsQuery = assetsQuery.lt('created_at', cursorCreatedAt)");
  includes('Assets list returns nextCursor', assetsRoute, 'nextCursor');

  const signedUrlRoute = read('src/app/api/content-studio/assets/[id]/signed-url/route.ts');
  includes('Signed URL route validates params', signedUrlRoute, 'validateParams(params, ContentStudioAssetParamsSchema)');
  includes('Signed URL route signs storage object', signedUrlRoute, '.createSignedUrl(objectPath, 60 * 60 * 24)');
  includes('Signed URL route returns signedUrl', signedUrlRoute, 'NextResponse.json({ signedUrl: signedData.signedUrl, request_id: requestId })');

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
