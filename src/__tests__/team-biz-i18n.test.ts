/**
 * Integration tests for Team fix + Biz Switcher + i18n
 * Run: npx tsx src/__tests__/team-biz-i18n.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
function assert(label: string, got: any, expected: any) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  ok ? pass++ : fail++;
}
function assertIncludes(label: string, haystack: string, needle: string) {
  const ok = haystack.includes(needle);
  console.log(ok ? '✅' : '❌', label);
  ok ? pass++ : fail++;
}

const root = path.resolve(__dirname, '..', '..');

// ============================================================
// PART A: Team Fix
// ============================================================
console.log('\n=== PART A: TEAM FIX ===');

// A1: Migration exists
const migPath = path.join(root, 'supabase/phase-l-missing-columns-team-fix.sql');
assert('Migration phase-l-missing-columns-team-fix.sql exists', fs.existsSync(migPath), true);

// A2: Migration has FK
const migContent = fs.readFileSync(migPath, 'utf8');
assertIncludes('Migration adds FK memberships→profiles', migContent, 'memberships_user_id_profiles_fk');
assertIncludes('Migration adds profiles_select_teammates policy', migContent, 'profiles_select_teammates');
assertIncludes('Migration reloads schema cache', migContent, "pg_notify('pgrst', 'reload schema')");

// A3: Team API has fallback strategy
const teamApi = fs.readFileSync(path.join(root, 'src/app/api/team/route.ts'), 'utf8');
assertIncludes('Team API uses FK hint in select', teamApi, 'memberships_user_id_profiles_fk');
assertIncludes('Team API has 2-query fallback', teamApi, 'Strategy 2');
assertIncludes('Team API fetches profiles separately in fallback', teamApi, "from('profiles')");

// A4: Team API has no `as any` in type-critical paths
const teamApiLines = teamApi.split('\n');
const asAnyCount = teamApiLines.filter(l => l.includes('as any') && !l.trim().startsWith('//')).length;
// Some `as any` in .map callbacks are acceptable for Supabase's loose types
// but the main query/response should be clean
assert('Team API has minimal as any', asAnyCount <= 5, true);

// A5: Settings Team tab exists
const settings = fs.readFileSync(path.join(root, 'src/app/dashboard/settings/page.tsx'), 'utf8');
const teamSettings = fs.readFileSync(path.join(root, 'src/components/settings/TeamSettings.tsx'), 'utf8');
assertIncludes('Settings has Team tab', settings, "'team'");
assertIncludes('Settings renders humanized team section', settings, 'settings.humanized.team.title');
assertIncludes('Team checks isOwner for permissions', teamSettings, 'isOwner');
assertIncludes('Team checks canManageTeam', teamSettings, 'canManageTeam');

// A6: All team endpoints exist
for (const ep of ['route.ts', 'invite/route.ts', 'role/route.ts', 'member/route.ts']) {
  assert(`team/${ep} exists`, fs.existsSync(path.join(root, 'src/app/api/team', ep)), true);
}

// A7: Role endpoint has last-owner protection
const roleApi = fs.readFileSync(path.join(root, 'src/app/api/team/role/route.ts'), 'utf8');
assertIncludes('Role change has last_owner check', roleApi, 'last_owner');

// A8: Delete endpoint has last-owner protection
const memberApi = fs.readFileSync(path.join(root, 'src/app/api/team/member/route.ts'), 'utf8');
assertIncludes('Member delete has last_owner check', memberApi, 'last_owner');

// ============================================================
// PART B: Business Switcher
// ============================================================
console.log('\n=== PART B: BUSINESS SWITCHER ===');

const layout = fs.readFileSync(path.join(root, 'src/app/dashboard/layout.tsx'), 'utf8');
assertIncludes('Layout has switchBiz', layout, 'switchBiz');
assertIncludes('Layout has switchOrg', layout, 'switchOrg');
assertIncludes('Layout renders biz dropdown', layout, 'businesses.map');
assertIncludes('Layout has bizOpen state', layout, 'bizOpen');

const wsCtx = fs.readFileSync(path.join(root, 'src/contexts/WorkspaceContext.tsx'), 'utf8');
assertIncludes('WorkspaceContext has switchBiz', wsCtx, 'switchBiz');
assertIncludes('WorkspaceContext has saveWorkspace persistence', wsCtx, 'saveWorkspace');
assertIncludes('WorkspaceContext has loadWorkspace restore', wsCtx, 'loadWorkspace');
assertIncludes('WorkspaceContext loads businesses for org', wsCtx, "from('businesses')");

// ============================================================
// PART C: i18n
// ============================================================
console.log('\n=== PART C: i18n ===');

// C1: getMessages uses dynamic import (Vercel-safe)
const getMsgs = fs.readFileSync(path.join(root, 'src/i18n/getMessages.ts'), 'utf8');
assertIncludes('getMessages uses import()', getMsgs, 'await import(');
assert('getMessages does NOT use fs.readFileSync', getMsgs.includes('readFileSync'), false);

// C2: getLocale reads from cookie
const getLoc = fs.readFileSync(path.join(root, 'src/i18n/getLocale.ts'), 'utf8');
assertIncludes('getLocale reads cookies', getLoc, 'cookies()');

// C3: Root layout passes locale + messages to I18nProvider
const rootLayout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
assertIncludes('Root layout calls getLocale', rootLayout, 'getLocale()');
assertIncludes('Root layout calls getMessages', rootLayout, 'getMessages(locale)');
assertIncludes('Root layout wraps in I18nProvider', rootLayout, 'I18nProvider');

// C4: LanguageSwitcher updates compat i18n state without hard refresh
const langSwitch = fs.readFileSync(path.join(root, 'src/components/i18n/LanguageSwitcher.tsx'), 'utf8');
assertIncludes('LanguageSwitcher calls /api/locale', langSwitch, '/api/locale');
assertIncludes('LanguageSwitcher updates setLocale in place', langSwitch, 'setLocale(newLocale)');
assert('LanguageSwitcher does NOT use router.refresh()', langSwitch.includes('router.refresh()'), false);
assert('LanguageSwitcher does NOT use window.location.reload()', langSwitch.includes('window.location.reload()'), false);

// C5: /api/locale sets cookie AND updates DB
const localeApi = fs.readFileSync(path.join(root, 'src/app/api/locale/route.ts'), 'utf8');
assertIncludes('Locale API sets cookie', localeApi, 'cookies.set');
assertIncludes('Locale API updates profiles.locale', localeApi, "update({ locale:");

// C6: Message files balanced
const msgDir = path.join(root, 'messages');
const caKeys = JSON.stringify(Object.keys(flattenObj(JSON.parse(fs.readFileSync(path.join(msgDir, 'ca.json'), 'utf8')))).sort());
const esKeys = JSON.stringify(Object.keys(flattenObj(JSON.parse(fs.readFileSync(path.join(msgDir, 'es.json'), 'utf8')))).sort());
const enKeys = JSON.stringify(Object.keys(flattenObj(JSON.parse(fs.readFileSync(path.join(msgDir, 'en.json'), 'utf8')))).sort());
assert('es.json has same keys as ca.json', esKeys, caKeys);
assert('en.json has same keys as ca.json', enKeys, caKeys);

// C7: Dashboard nav uses i18n
const dashLayout = fs.readFileSync(path.join(root, 'src/app/dashboard/layout.tsx'), 'utf8');
assertIncludes('Dashboard nav uses t() for labels', dashLayout, "t('nav.");

// C8: Middleware handles locale prefix stripping
const mw = fs.readFileSync(path.join(root, 'src/middleware.ts'), 'utf8');
assertIncludes('Middleware strips locale prefix', mw, 'isLocale(firstSeg)');
assertIncludes('Middleware sets locale cookie on strip', mw, 'LOCALE_COOKIE');

// ============================================================
// PART D: Zero breaking changes
// ============================================================
console.log('\n=== PART D: ZERO BREAKING CHANGES ===');

// Auth callback untouched
const authCb = fs.readFileSync(path.join(root, 'src/app/(auth)/callback/route.ts'), 'utf8');
assertIncludes('Auth callback intact', authCb, 'auth.exchangeCodeForSession');

// Circuit breaker untouched
const cb = fs.readFileSync(path.join(root, 'src/lib/llm/circuitBreaker.ts'), 'utf8');
assertIncludes('Circuit breaker intact', cb, 'CircuitBreaker');

// DLQ untouched
const dlq = fs.readFileSync(path.join(root, 'src/app/api/dlq/route.ts'), 'utf8');
assertIncludes('DLQ intact', dlq, 'failed_jobs');

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);

// Helper: flatten nested object to dot-notation keys
function flattenObj(obj: any, prefix = ''): Record<string, true> {
  const result: Record<string, true> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      Object.assign(result, flattenObj(v, key));
    } else {
      result[key] = true;
    }
  }
  return result;
}
