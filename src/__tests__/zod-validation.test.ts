/**
 * Zod Validation Layer Tests
 * Run: npx tsx src/__tests__/zod-validation.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
function assert(label: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `— got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  ok ? pass++ : fail++;
}
function includes(label: string, haystack: string, needle: string) {
  const ok = haystack.includes(needle);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `— "${needle}" not found`);
  ok ? pass++ : fail++;
}
function notIncludes(label: string, haystack: string, needle: string) {
  const ok = !haystack.includes(needle);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `— "${needle}" still present`);
  ok ? pass++ : fail++;
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));

// ═══════════════════════════════════════════
console.log('\n=== A: INFRASTRUCTURE ===');

assert('validations/helpers.ts exists', exists('src/lib/validations/helpers.ts'), true);
assert('validations/schemas.ts exists', exists('src/lib/validations/schemas.ts'), true);
assert('validations/index.ts exists', exists('src/lib/validations/index.ts'), true);

const helpers = read('src/lib/validations/helpers.ts');
includes('validateBody function exists', helpers, 'export async function validateBody');
includes('validateQuery function exists', helpers, 'export function validateQuery');
includes('validateParams function exists', helpers, 'export function validateParams');
includes('Returns tuple [data, null] | [null, NextResponse]', helpers, 'ValidationResult');
includes('Handles invalid JSON', helpers, 'invalid_json');
includes('Returns field-level errors', helpers, 'fieldErrors');
includes('Uses safeParse (not parse)', helpers, 'safeParse');
includes('Returns 400 status', helpers, '{ status: 400 }');

const schemas = read('src/lib/validations/schemas.ts');
includes('Has TeamInviteSchema', schemas, 'TeamInviteSchema');
includes('Has TeamRoleSchema', schemas, 'TeamRoleSchema');
includes('Has KBCreateSchema', schemas, 'KBCreateSchema');
includes('Has KBUpdateSchema', schemas, 'KBUpdateSchema');
includes('Has TriggerCreateSchema', schemas, 'TriggerCreateSchema');
includes('Has TriggerUpdateSchema', schemas, 'TriggerUpdateSchema');
includes('Has TriggerTestSchema', schemas, 'TriggerTestSchema');
includes('Has GrowthLinkCreateSchema', schemas, 'GrowthLinkCreateSchema');
includes('Has CompetitorCreateSchema', schemas, 'CompetitorCreateSchema');
includes('Has BillingUpdateSchema', schemas, 'BillingUpdateSchema');
includes('Has AuditLogSchema', schemas, 'AuditLogSchema');
includes('Has LocaleSchema', schemas, 'LocaleSchema');
includes('Has OpsActionCreateSchema', schemas, 'OpsActionCreateSchema');
includes('Has OpsActionUpdateSchema', schemas, 'OpsActionUpdateSchema');
includes('Has JobRunSchema', schemas, 'JobRunSchema');
includes('Has DLQActionSchema', schemas, 'DLQActionSchema');
includes('Has DemoGenerateSchema', schemas, 'DemoGenerateSchema');
includes('Has DemoSeedSchema', schemas, 'DemoSeedSchema');
includes('Has ReviewAuditSchema', schemas, 'ReviewAuditSchema');
includes('Has ApproveReplySchema', schemas, 'ApproveReplySchema');
includes('Has GenerateModifierSchema', schemas, 'GenerateModifierSchema');
includes('Has ReviewGenerateParamsSchema', schemas, 'ReviewGenerateParamsSchema');
includes('Has ReviewGenerateBodySchema', schemas, 'ReviewGenerateBodySchema');
includes('Has ProfileDetectSchema', schemas, 'ProfileDetectSchema');
includes('Uses z.string().uuid()', schemas, '.uuid(');
includes('Uses z.string().email()', schemas, '.email(');
includes('Uses z.enum()', schemas, 'z.enum(');

const barrel = read('src/lib/validations/index.ts');
includes('Barrel exports validateBody', barrel, 'validateBody');
includes('Barrel re-exports schemas', barrel, "export * from './schemas'");

// ═══════════════════════════════════════════
console.log('\n=== B: MIGRATED ROUTES ===');

// Team invite
const teamInvite = read('src/app/api/team/invite/route.ts');
includes('team/invite uses validateBody', teamInvite, 'validateBody');
includes('team/invite uses TeamInviteSchema', teamInvite, 'TeamInviteSchema');
notIncludes('team/invite: no manual parsing', teamInvite, 'const { org_id, email, role } = body');

// Team role
const teamRole = read('src/app/api/team/role/route.ts');
includes('team/role uses validateBody', teamRole, 'validateBody');
includes('team/role uses TeamRoleSchema', teamRole, 'TeamRoleSchema');
notIncludes('team/role: no manual validation', teamRole, "if (!membership_id || !role)");

// KB
const kb = read('src/app/api/kb/route.ts');
includes('kb POST uses KBCreateSchema', kb, 'KBCreateSchema');
includes('kb PATCH uses KBUpdateSchema', kb, 'KBUpdateSchema');

// Triggers
const triggers = read('src/app/api/triggers/route.ts');
includes('triggers POST uses TriggerCreateSchema', triggers, 'TriggerCreateSchema');
includes('triggers PUT uses TriggerUpdateSchema', triggers, 'TriggerUpdateSchema');
notIncludes('triggers: no manual VALID_ACTIONS check', triggers, 'VALID_ACTIONS');

// Triggers test
const triggersTest = read('src/app/api/triggers/test/route.ts');
includes('triggers/test uses TriggerTestSchema', triggersTest, 'TriggerTestSchema');

// Billing
const billing = read('src/app/api/billing/route.ts');
includes('billing uses BillingUpdateSchema', billing, 'BillingUpdateSchema');

// Audit
const audit = read('src/app/api/audit/route.ts');
includes('audit uses AuditLogSchema', audit, 'AuditLogSchema');

// Growth links
const growth = read('src/app/api/growth-links/route.ts');
includes('growth-links uses GrowthLinkCreateSchema', growth, 'GrowthLinkCreateSchema');

// Locale
const locale = read('src/app/api/locale/route.ts');
includes('locale uses LocaleSchema', locale, 'LocaleSchema');
notIncludes('locale: no isLocale manual check', locale, 'isLocale(locale)');

// Ops actions
const ops = read('src/app/api/ops-actions/route.ts');
includes('ops-actions POST uses OpsActionCreateSchema', ops, 'OpsActionCreateSchema');
includes('ops-actions PATCH uses OpsActionUpdateSchema', ops, 'OpsActionUpdateSchema');

// Replies approve
const approve = read('src/app/api/replies/[replyId]/approve/route.ts');
includes('replies/approve uses ApproveReplySchema', approve, 'ApproveReplySchema');

// DLQ
const dlq = read('src/app/api/dlq/route.ts');
includes('dlq POST uses DLQActionSchema', dlq, 'DLQActionSchema');

// Jobs
const jobs = read('src/app/api/jobs/route.ts');
includes('jobs POST uses JobRunSchema', jobs, 'JobRunSchema');

// Demo seed
const demoSeed = read('src/app/api/demo-seed/route.ts');
includes('demo-seed POST uses DemoSeedSchema', demoSeed, 'DemoSeedSchema');

// Demo generate
const demoGenerate = read('src/app/api/demo-generate/route.ts');
includes('demo-generate POST uses DemoGenerateSchema', demoGenerate, 'DemoGenerateSchema');

// Review audit
const reviewAudit = read('src/app/api/review-audit/route.ts');
includes('review-audit POST uses ReviewAuditSchema', reviewAudit, 'ReviewAuditSchema');

// Competitors
const competitors = read('src/app/api/competitors/route.ts');
includes('competitors POST uses CompetitorCreateSchema', competitors, 'CompetitorCreateSchema');

// Profile detect
const profileDetect = read('src/app/api/profile-detect/route.ts');
includes('profile-detect POST uses ProfileDetectSchema', profileDetect, 'ProfileDetectSchema');

// ═══════════════════════════════════════════
console.log('\n=== C: PATTERN CONSISTENCY ===');

// All migrated routes use the same pattern: const [body, err] = await validateBody(...)
const migratedRoutes = [
  teamInvite,
  teamRole,
  kb,
  triggers,
  triggersTest,
  billing,
  audit,
  growth,
  locale,
  ops,
  approve,
  dlq,
  jobs,
  demoSeed,
  demoGenerate,
  reviewAudit,
  competitors,
  profileDetect,
];

let patternCount = 0;
for (const route of migratedRoutes) {
  if (route.includes('const [body, err] = await validateBody')) patternCount++;
}
assert('All 18 routes use const [body, err] pattern', patternCount, 18);

// No raw request.json() in migrated POST/PATCH/PUT handlers
let rawJsonCount = 0;
for (const route of migratedRoutes) {
  // Count request.json() calls NOT inside validateBody
  const lines = route.split('\n');
  for (const line of lines) {
    if (line.includes('request.json()') && !line.includes('validateBody') && !line.includes('// validateBody')) {
      rawJsonCount++;
    }
  }
}
assert('No raw request.json() in migrated routes', rawJsonCount, 0);

// ═══════════════════════════════════════════
console.log('\n=== D: NON-BREAKING ===');

// generate/route.ts IS now migrated (Pas 8)
const generate = read('src/app/api/reviews/[reviewId]/generate/route.ts');
includes('generate/route.ts uses validateBody (Pas 8)', generate, "from '@/lib/validations'");
includes('generate/route.ts uses runPipeline', generate, "from '@/lib/pipeline'");

includes('demo-generate migrated', demoGenerate, 'validateBody');
includes('demo-seed migrated', demoSeed, 'validateBody');
includes('dlq migrated', dlq, 'validateBody');
includes('jobs migrated', jobs, 'validateBody');
includes('competitors migrated', competitors, 'validateBody');
includes('review-audit migrated', reviewAudit, 'validateBody');
includes('profile-detect migrated', profileDetect, 'validateBody');

// ═══════════════════════════════════════════
console.log('\n=== E: PACKAGE.JSON ===');
const pkg = read('package.json');
includes('zod in dependencies', pkg, '"zod"');

// ═══════════════════════════════════════════
console.log('\n=== F: EXISTING TESTS STILL REFERENCE VALID CODE ===');
assert('team.test.ts exists', exists('src/__tests__/team.test.ts'), true);
assert('seo-triggers.test.ts exists', exists('src/__tests__/seo-triggers.test.ts'), true);
assert('consolidated-fix.test.ts exists', exists('src/__tests__/consolidated-fix.test.ts'), true);

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
