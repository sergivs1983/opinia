/**
 * Satori smoke test (PERF-1).
 * Run: npx tsx src/__tests__/render-satori-smoke.test.ts
 */

import { buildStudioRenderPayload } from '../lib/content-studio';
import { renderWithSatori } from '../lib/render/engines/satori';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass += 1;
  else fail += 1;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function run() {
  console.log('\n=== SATORI SMOKE ===');

  const payload = buildStudioRenderPayload({
    suggestion: {
      title: 'Fast welcome moments',
      hook: 'How we keep arrivals smooth and warm.',
      caption: 'A short look at our welcome workflow and service quality.',
      cta: 'Book this week',
      best_time: 'Thu 7:30 PM',
      shot_list: ['Door open', 'Front desk', 'Room handoff'],
      hashtags: ['#welcome', '#hospitality'],
      evidence: [{ review_id: 'r1', quote: 'Fast check-in and friendly staff.' }],
    },
    business: {
      name: 'Hotel Test',
      default_language: 'en',
    },
    language: 'en',
    format: 'story',
    templateId: 'quote-clean',
  });

  const result = await renderWithSatori(payload);

  assert('Engine is satori', result.engine === 'satori');
  assert('PNG buffer is non-empty', result.pngBuffer.byteLength > 0);
  assert('PNG base64 is non-empty', result.pngBase64.length > 40);
  assert('Width > 0', result.width > 0);
  assert('Height > 0', result.height > 0);
  assert(
    'PNG signature is valid',
    result.pngBuffer.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE),
  );

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

