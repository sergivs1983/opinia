/**
 * Weekly Export Pack (EP-1) contract tests.
 * Run: npx tsx src/__tests__/exports-weekly-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ExportParamsSchema,
  ExportsListQuerySchema,
  ExportWeeklyBodySchema,
} from '../lib/validations/schemas';
import {
  buildWeeklyZip,
  resolveExportLanguage,
} from '../lib/exports';

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

const weeklyHappy = ExportWeeklyBodySchema.safeParse({
  weekStart: '2026-02-16',
});
assert('Weekly export body happy (minimal)', weeklyHappy.success);

const weeklyInvalid = ExportWeeklyBodySchema.safeParse({
  weekStart: '16/02/2026',
});
assert('Weekly export body invalid weekStart', !weeklyInvalid.success);

const paramsHappy = ExportParamsSchema.safeParse({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
});
assert('Export signed-url params happy', paramsHappy.success);

const listQueryHappy = ExportsListQuerySchema.safeParse({
  weekStart: '2026-02-16',
  language: 'en',
  limit: 20,
});
assert('Exports list query happy', listQueryHappy.success);

console.log('\n=== LANGUAGE RESOLUTION ===');

const resolvedLanguage = resolveExportLanguage({
  requestedLanguage: undefined,
  business: { default_language: 'es' },
  orgLocale: 'ca',
});
assert('Language resolution follows business fallback', resolvedLanguage === 'es');

console.log('\n=== ZIP BUNDLE ===');

const zipBundle = buildWeeklyZip({
  manifest: {
    week_start: '2026-02-16',
    language: 'en',
    items_count: 1,
    generated_at: new Date().toISOString(),
    request_id: 'req_test_exports',
  },
  items: [{
    id: 'planner-1',
    scheduled_at: '2026-02-19T19:30:00.000Z',
    channel: 'ig_feed',
    title: 'Weekly post',
    caption: 'Caption example',
    cta: 'Book now',
    status: 'planned',
    asset_filename: 'asset_1.png',
  }],
  includeCsv: true,
  includeTexts: true,
  includeReadme: true,
  assetFiles: [{
    filename: 'asset_1.png',
    data: Buffer.from('png-data'),
  }],
});

assert('ZIP bytes > 0', zipBundle.zipBuffer.byteLength > 0);
assert('ZIP includes manifest entry', zipBundle.entries.includes('manifest.json'));
assert('ZIP includes planner.csv entry', zipBundle.entries.includes('planner.csv'));
assert('ZIP includes text file entry', zipBundle.entries.includes('texts/planner-1.txt'));

console.log('\n=== ROUTE CONTRACT ===');

const weeklyRoute = read('src/app/api/exports/weekly/route.ts');
includes('Weekly route validates body', weeklyRoute, 'validateBody(request, ExportWeeklyBodySchema)');
includes('Weekly route normalizes weekStart to Monday', weeklyRoute, 'normalizeWeekStartMonday(payload.weekStart)');
includes('Weekly route uses workspace business header', weeklyRoute, "request.headers.get('x-biz-id')");
includes('Weekly route inserts/updates exports table', weeklyRoute, "from('exports')");
includes('Weekly route returns signed URL', weeklyRoute, 'signedUrl: signedData.signedUrl');
includes('Weekly route supports debug manifest', weeklyRoute, 'manifest: buildManifestJson(manifest)');
includes('Weekly route sets request id in body', weeklyRoute, 'request_id: requestId');

const signedRoute = read('src/app/api/exports/[id]/signed-url/route.ts');
includes('Signed URL route validates params', signedRoute, 'validateParams(params, ExportParamsSchema)');
includes('Signed URL route enforces workspace ownership', signedRoute, 'workspaceBusinessId && workspaceBusinessId !== exportRow.business_id');
includes('Signed URL route signs URL for 24h', signedRoute, '.createSignedUrl(objectPath, 60 * 60 * 24)');

const listRoute = read('src/app/api/exports/route.ts');
includes('Exports list route validates query', listRoute, 'validateQuery(request, ExportsListQuerySchema)');
includes('Exports list route filters by week', listRoute, "exportsQuery = exportsQuery.eq('week_start', normalizeWeekStartMonday(payload.weekStart))");
includes('Exports list route filters by language', listRoute, "exportsQuery = exportsQuery.eq('language', payload.language)");

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
