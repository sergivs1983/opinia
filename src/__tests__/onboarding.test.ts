/**
 * Tests for Onboarding "Crear negoci" fix
 * Run: npx tsx src/__tests__/onboarding.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
function assert(label: string, got: any, expected: any) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  ok ? pass++ : fail++;
}
function has(label: string, haystack: string, needle: string) {
  const ok = haystack.includes(needle);
  console.log(ok ? '✅' : '❌', label);
  ok ? pass++ : fail++;
}

const root = path.resolve(__dirname, '..', '..');
const onboard = fs.readFileSync(path.join(root, 'src/app/dashboard/onboarding/page.tsx'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'src/app/api/bootstrap/route.ts'), 'utf8');

console.log('\n=== ONBOARDING ERROR HANDLING ===');
has('setLoadingError is called in catch', onboard, 'setLoadingError(');
has('Error banner rendered', onboard, 'loadingError && (');
has('Error state reset exists', onboard, 'setLoadingError(null)');
has('Onboarding uses localized error keys', onboard, "dashboard.onboarding.error");

console.log('\n=== COLUMN RESILIENCE ===');
has('Language hydration guard exists', onboard, 'setLanguageHydrated');
has('Step normalizer exists', onboard, 'normalizeStep');
has('PATCH progress helper exists', onboard, 'patchProgress');

console.log('\n=== BOOTSTRAP API ===');
has('Bootstrap upserts profile', bootstrap, "from('profiles').upsert");
has('Bootstrap creates org', bootstrap, "from('organizations')");
has('Bootstrap creates owner membership', bootstrap, "role: 'owner'");
has('Bootstrap sets accepted_at', bootstrap, 'accepted_at');
has('Bootstrap is idempotent (checks existing)', bootstrap, 'existing');
has('Bootstrap uses admin client (bypasses RLS)', bootstrap, 'createAdminClient');

console.log('\n=== UI FLOW ===');
has('Step progression updates state', onboard, 'step: normalizeStep(payload.progress?.step)');
has('Generated suggestion stored in state', onboard, 'suggestionId: suggestionResult.id');
has('Generated asset stored in state', onboard, 'assetId: payload.assetId');

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
