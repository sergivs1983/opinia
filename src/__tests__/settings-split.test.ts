/**
 * Pas 1 Verification — Settings Page Split
 * Run: npx tsx src/__tests__/settings-split.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
function assert(label: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `— got ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (content: string, needle: string) => content.includes(needle);
const exists = (p: string) => fs.existsSync(path.join(root, p));

// ═══════════════════════════════════════════
console.log('\n=== A: FILE STRUCTURE ===');
const files = [
  'VoiceSettings.tsx', 'BusinessMemorySettings.tsx', 'BillingSettings.tsx',
  'IntegrationsPlaceholder.tsx', 'GrowthSettings.tsx', 'SafetySettings.tsx',
  'LanguageSettings.tsx', 'ActionTriggersSettings.tsx', 'TeamSettings.tsx',
  'types.ts', 'index.ts',
];
files.forEach(f => assert(`${f} exists`, exists(`src/components/settings/${f}`), true));

// ═══════════════════════════════════════════
console.log('\n=== B: ORCHESTRATOR ===');
const page = read('src/app/dashboard/settings/page.tsx');
const pageLines = page.split('\n').length;
assert(`Page has implementation content (${pageLines} lines > 100)`, pageLines > 100, true);
assert('Imports shared UI components', has(page, "from '@/components/ui/"), true);
assert('Has SettingsTab type union', has(page, 'SettingsTab'), true);
assert('Has typed useState', has(page, 'useState<SettingsTab>'), true);
assert('Has useWorkspace', has(page, 'useWorkspace'), true);
assert('Renders humanized tabs (autopilot included)', has(page, "'autopilot'"), true);
assert('No VoiceSettings function inside', has(page, 'function VoiceSettings'), false);
assert('No TeamSettings function inside', has(page, 'function TeamSettings'), false);
assert('No BillingSettings function inside', has(page, 'function BillingSettings'), false);

// ═══════════════════════════════════════════
console.log('\n=== C: ZERO any ===');
let totalAny = 0;
files.filter(f => f.endsWith('.tsx')).forEach(f => {
  const content = read(`src/components/settings/${f}`);
  const count = (content.match(/: any\b|as any\b/g) || []).length;
  totalAny += count;
  if (count > 0) console.log(`  ⚠️  ${f} has ${count} 'any'`);
});
const pageAny = (page.match(/: any\b|as any\b/g) || []).length;
totalAny += pageAny;
assert(`Total any = 0 (was 14 in original)`, totalAny, 0);

// ═══════════════════════════════════════════
console.log('\n=== D: TYPED PROPS ===');
const types = read('src/components/settings/types.ts');
assert('types.ts has BizSettingsProps', has(types, 'BizSettingsProps'), true);
assert('types.ts has BizOrgProps', has(types, 'BizOrgProps'), true);
assert('types.ts has OrgProps', has(types, 'OrgProps'), true);
assert('types.ts has BizSettingsProps+BizOrgProps+OrgProps', has(types, 'BizSettingsProps') && has(types, 'BizOrgProps') && has(types, 'OrgProps'), true);
assert('types.ts imports Business', has(types, 'Business'), true);
assert('types.ts imports Organization', has(types, 'Organization'), true);

assert('VoiceSettings uses BizSettingsProps', has(read('src/components/settings/VoiceSettings.tsx'), 'BizSettingsProps'), true);
assert('BillingSettings uses OrgProps', has(read('src/components/settings/BillingSettings.tsx'), 'OrgProps'), true);
assert('SafetySettings uses SafetySettingsProps', has(read('src/components/settings/SafetySettings.tsx'), 'SafetySettingsProps'), true);
assert('GrowthSettings uses BizOrgProps', has(read('src/components/settings/GrowthSettings.tsx'), 'BizOrgProps'), true);
assert('ActionTriggers imports BizOrgProps', has(read('src/components/settings/ActionTriggersSettings.tsx'), 'BizOrgProps'), true);
assert('TeamSettings uses typed catch', has(read('src/components/settings/TeamSettings.tsx'), 'e instanceof Error'), true);
assert('BillingSettings has BillingData interface', has(read('src/components/settings/BillingSettings.tsx'), 'interface BillingData'), true);

// ═══════════════════════════════════════════
console.log('\n=== E: SELF-CONTAINED COMPONENTS ===');
files.filter(f => f.endsWith('.tsx')).forEach(f => {
  const content = read(`src/components/settings/${f}`);
  assert(`${f} has 'use client'`, has(content, "'use client'"), true);
  assert(`${f} has default export`, has(content, 'export default'), true);
});

// ═══════════════════════════════════════════
console.log('\n=== F: BARREL EXPORT ===');
const barrel = read('src/components/settings/index.ts');
['VoiceSettings', 'BusinessMemorySettings', 'BillingSettings', 'IntegrationsPlaceholder',
 'GrowthSettings', 'SafetySettings', 'LanguageSettings', 'ActionTriggersSettings', 'TeamSettings'
].forEach(name => assert(`index.ts exports ${name}`, has(barrel, name), true));

// ═══════════════════════════════════════════
console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
