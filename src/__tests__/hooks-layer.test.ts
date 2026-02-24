/**
 * Minimal hooks layer verification.
 * Run: npx tsx src/__tests__/hooks-layer.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));

console.log('\n=== HOOK FILES ===');
assert('useSupabase.ts exists', exists('src/hooks/useSupabase.ts'));
assert('useBusiness.ts exists', exists('src/hooks/useBusiness.ts'));
assert('useReviews.ts exists', exists('src/hooks/useReviews.ts'));
assert('useTeamMembers.ts exists', exists('src/hooks/useTeamMembers.ts'));

const useSupabase = read('src/hooks/useSupabase.ts');
assert('useSupabase wraps createClient', useSupabase.includes('createClient'));

console.log('\n=== INTEGRATION (2-3 REFACTORS) ===');
const teamSettings = read('src/components/settings/TeamSettings.tsx');
assert('TeamSettings uses useTeamMembers', teamSettings.includes('useTeamMembers'));

const inbox = read('src/app/dashboard/inbox/page.tsx');
assert('Inbox uses useReviews', inbox.includes('useReviews'));
assert('Inbox uses useSupabase', inbox.includes('useSupabase'));

const status = read('src/app/dashboard/status/page.tsx');
assert('Status uses useBusiness', status.includes('useBusiness'));

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
