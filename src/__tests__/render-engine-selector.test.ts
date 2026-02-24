/**
 * Render engine selector tests (PERF-1).
 * Run: npx tsx src/__tests__/render-engine-selector.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { TEMPLATE_ENGINE, resolveRenderEngine } from '../lib/render';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass += 1;
  else fail += 1;
}

function includes(label: string, haystack: string, needle: string) {
  assert(label, haystack.includes(needle));
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

console.log('\n=== ENGINE MAP ===');
assert('quote-clean uses satori', TEMPLATE_ENGINE['quote-clean'] === 'satori');
assert('feature-split uses satori', TEMPLATE_ENGINE['feature-split'] === 'satori');
assert('top3-reasons uses playwright', TEMPLATE_ENGINE['top3-reasons'] === 'playwright');
assert('behind-scenes uses playwright', TEMPLATE_ENGINE['behind-scenes'] === 'playwright');

console.log('\n=== ENGINE SELECTOR ===');
assert('resolve quote-clean -> satori', resolveRenderEngine('quote-clean') === 'satori');
assert('resolve feature-split -> satori', resolveRenderEngine('feature-split') === 'satori');
assert('resolve top3-reasons -> playwright', resolveRenderEngine('top3-reasons') === 'playwright');
assert('resolve unknown -> playwright', resolveRenderEngine('unknown-template') === 'playwright');
assert('resolve empty -> playwright', resolveRenderEngine('') === 'playwright');

console.log('\n=== ROUTE CONTRACT ===');
const renderRoute = read('src/app/api/content-studio/render/route.ts');
includes('Render route uses renderStudioWithEngine', renderRoute, 'renderStudioWithEngine(renderPayload)');
includes('Render route supports test render-engine header', renderRoute, "response.headers.set('x-render-engine', renderEngine)");

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);

