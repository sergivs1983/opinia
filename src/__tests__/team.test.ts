/**
 * Tests for Multi-business + Team feature
 * Run: npx tsx src/__tests__/team.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
function assert(label: string, got: any, expected: any) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  ok ? pass++ : fail++;
}

const root = path.resolve(__dirname, '..', '..');

// ============================================================
// 1. API endpoint files exist
// ============================================================
console.log('\n=== API ENDPOINT FILES ===');

const endpoints = [
  'src/app/api/team/route.ts',            // GET /api/team
  'src/app/api/team/invite/route.ts',      // POST /api/team/invite
  'src/app/api/team/role/route.ts',        // PATCH /api/team/role
  'src/app/api/team/member/route.ts',      // DELETE /api/team/member
];

for (const ep of endpoints) {
  const exists = fs.existsSync(path.join(root, ep));
  assert(`${ep} exists`, exists, true);
}

// ============================================================
// 2. Endpoints export correct HTTP methods
// ============================================================
console.log('\n=== HTTP METHOD EXPORTS ===');

const methodChecks = [
  { file: 'src/app/api/team/route.ts', method: 'GET' },
  { file: 'src/app/api/team/invite/route.ts', method: 'POST' },
  { file: 'src/app/api/team/role/route.ts', method: 'PATCH' },
  { file: 'src/app/api/team/member/route.ts', method: 'DELETE' },
];

for (const { file, method } of methodChecks) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  const hasMethod = content.includes(`export async function ${method}`);
  assert(`${file} exports ${method}`, hasMethod, true);
}

// ============================================================
// 3. Role endpoint has last-owner protection
// ============================================================
console.log('\n=== SAFETY CHECKS ===');

const roleContent = fs.readFileSync(path.join(root, 'src/app/api/team/role/route.ts'), 'utf8');
assert('Role endpoint checks last owner', roleContent.includes('last_owner'), true);

const memberContent = fs.readFileSync(path.join(root, 'src/app/api/team/member/route.ts'), 'utf8');
assert('Delete endpoint checks last owner', memberContent.includes('last_owner'), true);

// ============================================================
// 4. Invite endpoint has duplicate check
// ============================================================
const inviteContent = fs.readFileSync(path.join(root, 'src/app/api/team/invite/route.ts'), 'utf8');
assert('Invite checks already_invited', inviteContent.includes('already_invited'), true);

// ============================================================
// 5. Settings page has Team tab
// ============================================================
console.log('\n=== UI INTEGRATION ===');

const settingsContent = fs.readFileSync(path.join(root, 'src/components/settings/TeamSettings.tsx'), 'utf8');
const orchestratorContent = fs.readFileSync(path.join(root, 'src/app/dashboard/settings/page.tsx'), 'utf8');
assert('Settings has team tab type', orchestratorContent.includes("'team'"), true);
assert('Settings has humanized team section render', orchestratorContent.includes('settings.humanized.team.title'), true);
assert('Settings has team tab label', orchestratorContent.includes('settings.humanized.tabs.team'), true);

// ============================================================
// 6. TeamSettings component exists and has key features
// ============================================================
assert('TeamSettings has member list', settingsContent.includes('settings.team.members'), true);
assert('TeamSettings has invite form', settingsContent.includes('settings.team.invite'), true);
assert('TeamSettings has role change', settingsContent.includes('/api/team/role'), true);
assert('TeamSettings has member removal', settingsContent.includes('/api/team/member'), true);
assert('TeamSettings has pending invites', settingsContent.includes('settings.team.pending'), true);
assert('TeamSettings has permissions info', settingsContent.includes('settings.team'), true);

// ============================================================
// 7. Business switcher exists in dashboard layout
// ============================================================
console.log('\n=== BUSINESS SWITCHER ===');

const layoutContent = fs.readFileSync(path.join(root, 'src/app/dashboard/layout.tsx'), 'utf8');
assert('Layout has switchBiz', layoutContent.includes('switchBiz'), true);
assert('Layout has switchOrg', layoutContent.includes('switchOrg'), true);
assert('Layout has businesses list', layoutContent.includes('businesses.map'), true);

// ============================================================
// 8. WorkspaceContext not modified
// ============================================================
console.log('\n=== WORKSPACE CONTEXT INTACT ===');

const wsContent = fs.readFileSync(path.join(root, 'src/contexts/WorkspaceContext.tsx'), 'utf8');
assert('WorkspaceContext has switchBiz', wsContent.includes('switchBiz'), true);
assert('WorkspaceContext has switchOrg', wsContent.includes('switchOrg'), true);
assert('WorkspaceContext has saveWorkspace', wsContent.includes('saveWorkspace'), true);
assert('WorkspaceContext has loadWorkspace', wsContent.includes('loadWorkspace'), true);
assert('WorkspaceContext has membership', wsContent.includes('membership'), true);

// ============================================================
// 9. Types exist
// ============================================================
console.log('\n=== TYPES ===');

const typesContent = fs.readFileSync(path.join(root, 'src/types/database.ts'), 'utf8');
assert('MemberRole type exists', typesContent.includes('MemberRole'), true);
assert('Membership interface exists', typesContent.includes('interface Membership'), true);

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
