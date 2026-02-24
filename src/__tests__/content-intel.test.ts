/**
 * Content Intelligence MVP tests.
 * Run: npx tsx src/__tests__/content-intel.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ContentIntelGenerateSchema,
  ContentSuggestionPatchSchema,
  ContentSuggestionParamsSchema,
} from '../lib/validations/schemas';
import {
  fallbackBestTime,
  buildFallbackInsight,
  buildFallbackSuggestions,
  normalizeSuggestions,
  type ReviewForContentIntel,
} from '../lib/content-intel';

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

const reviews: ReviewForContentIntel[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    source: 'google',
    review_text: 'Great service and friendly team. We loved the fast check-in and clean room.',
    rating: 5,
    review_date: '2026-02-16T12:00:00.000Z',
    created_at: '2026-02-16T12:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    source: 'tripadvisor',
    review_text: 'Location was excellent but breakfast could improve during busy hours.',
    rating: 3,
    review_date: '2026-02-17T18:30:00.000Z',
    created_at: '2026-02-17T18:30:00.000Z',
  },
];

console.log('\n=== SCHEMAS ===');

const validGenerate = ContentIntelGenerateSchema.safeParse({
  businessId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  weekStart: '2026-02-16',
  language: 'en',
});
assert('Generate payload happy path', validGenerate.success);
assert('maxReviews defaults to 50', validGenerate.success && validGenerate.data.maxReviews === 50);

const invalidGenerate = ContentIntelGenerateSchema.safeParse({
  businessId: 'not-uuid',
  weekStart: '2026/02/16',
  maxReviews: 500,
  language: 'fr',
});
assert('Generate payload invalid path', !invalidGenerate.success);

const validPatch = ContentSuggestionPatchSchema.safeParse({ status: 'approved' });
assert('Suggestion PATCH schema happy', validPatch.success);

const validParams = ContentSuggestionParamsSchema.safeParse({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
});
assert('Suggestion params schema happy', validParams.success);

console.log('\n=== FALLBACK + NORMALIZATION ===');

const fallbackInsight = buildFallbackInsight({
  language: 'en',
  reviews,
  businessType: 'hotel',
});
assert('Fallback insight includes themes', fallbackInsight.top_themes.length > 0);
assert('Fallback insight includes differentiators', fallbackInsight.differentiators.length > 0);

const fallbackSuggestions = buildFallbackSuggestions({
  language: 'en',
  reviews,
  differentiators: fallbackInsight.differentiators,
  peakTimesGuess: fallbackInsight.derived_business_profile.peak_times_guess,
  contentAngles: fallbackInsight.derived_business_profile.content_angles,
});
assert('Fallback creates 3 suggestions', fallbackSuggestions.length === 3);

const normalized = normalizeSuggestions({
  raw: [
    {
      type: 'reel',
      title: 'Fast check-in angle',
      hook_0_3s: 'How we keep check-in smooth.',
      shot_list: ['Lobby moment', 'Team greeting', 'Check-in flow'],
      caption: 'Behind the scenes of a fast check-in process.',
      cta: 'Book now',
      best_time: '',
      hashtags: ['hotel', 'travel'],
      evidence: [
        {
          review_id: reviews[0].id,
          quote: 'fast check-in and clean room',
        },
      ],
    },
  ],
  options: {
    language: 'en',
    reviews,
    differentiators: fallbackInsight.differentiators,
    peakTimesGuess: ['evening'],
  },
  contentAngles: fallbackInsight.derived_business_profile.content_angles,
});
assert('Normalization always yields 3 suggestions', normalized.length === 3);
assert('First normalized keeps type', normalized[0].type === 'reel');
assert('First normalized keeps evidence quote', normalized[0].evidence.length > 0);

assert('Best time fallback (ca default)', fallbackBestTime('ca', [], '') === 'Dj 19:30');
assert('Best time fallback (es default)', fallbackBestTime('es', [], '') === 'Jue 19:30');
assert('Best time fallback (en midday)', fallbackBestTime('en', ['midday'], '') === 'Tue 1:00 PM');

console.log('\n=== ROUTE CONTRACT ===');

const route = read('src/app/api/content-intel/generate/route.ts');
includes('Generate route uses validateBody', route, 'validateBody(request, ContentIntelGenerateSchema)');
includes('Generate route resolves language', route, 'resolveContentIntelLanguage');
includes('Generate route stores insights', route, "from('content_insights')");
includes('Generate route upserts insight row', route, '.upsert(');
includes('Generate route stores suggestions', route, "from('content_suggestions')");
includes('Generate route saves exactly 3 suggestions', route, 'suggestions.slice(0, 3)');
includes('Generate route sets x-request-id', route, "response.headers.set('x-request-id', requestId)");

const patchRoute = read('src/app/api/content-intel/suggestions/[id]/route.ts');
includes('PATCH route validates params', patchRoute, 'validateParams(params, ContentSuggestionParamsSchema)');
includes('PATCH route validates body', patchRoute, 'validateBody(request, ContentSuggestionPatchSchema)');
includes('PATCH route updates status', patchRoute, '.update({ status: body.status })');
includes('PATCH route validates workspace header', patchRoute, "request.headers.get('x-biz-id')");

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
