/**
 * Consolidated Fix Tests: Onboarding + i18n + Team
 * Run: npx tsx src/__tests__/consolidated-fix.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
function assert(label: string, got: any, expected: any) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(ok ? '✅' : '❌', label, ok ? '' : `— got ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}
function includes(label: string, haystack: string, needle: string) {
  const ok = haystack.includes(needle);
  console.log(ok ? '✅' : '❌', label);
  ok ? pass++ : fail++;
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));

// ============================================================
// BUG 1: ONBOARDING
// ============================================================
console.log('\n=== BUG 1: ONBOARDING ===');

const onboardingPath = exists('src/app/onboarding/page.tsx')
  ? 'src/app/onboarding/page.tsx'
  : 'src/app/dashboard/onboarding/page.tsx';
const onboardingSource = read(onboardingPath);
const onb = onboardingSource.includes('setLoadingError')
  ? onboardingSource
  : read('src/app/dashboard/onboarding/page.tsx');
includes('Onboarding has error state', onb, 'const [loadingError, setLoadingError]');
includes('Onboarding has dismiss button on error', onb, 'setLoadingError(null)');
includes('Onboarding keeps language hydration guard', onb, 'setLanguageHydrated');
includes('Onboarding sets error message on catch', onb, "setLoadingError(error instanceof Error");
includes('Onboarding uses localized error keys', onb, "dashboard.onboarding.errorLoad");
includes('Onboarding keeps business-scoped API headers', onb, "'x-biz-id': biz.id");

// Verify the migration adds missing columns
const mig = read('supabase/phase-m-consolidated-fix.sql');
includes('Migration adds supported_languages', mig, 'supported_languages');
includes('Migration adds tone_keywords_positive', mig, 'tone_keywords_positive');
includes('Migration adds tone_keywords_negative', mig, 'tone_keywords_negative');
includes('Migration adds response_max_length', mig, 'response_max_length');
includes('Migration adds auto_publish_enabled', mig, 'auto_publish_enabled');

// ============================================================
// BUG 2: i18n
// ============================================================
console.log('\n=== BUG 2: i18n ===');

const lang = read('src/components/i18n/LanguageSwitcher.tsx');
assert('LanguageSwitcher does NOT use window.location.reload()', lang.includes('window.location.reload()'), false);
includes('LanguageSwitcher updates context locale in place', lang, 'setLocale(newLocale)');
// Verify compat layer does not depend on router refresh
const langCodeLines = lang.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
const langCode = langCodeLines.join('\n');
assert('LanguageSwitcher code does NOT call router.refresh()', langCode.includes('router.refresh()'), false);
includes('LanguageSwitcher calls /api/locale', lang, '/api/locale');

const localeApi = read('src/app/api/locale/route.ts');
includes('Locale API sets cookie', localeApi, 'cookies.set');
includes('Locale API updates profiles.locale', localeApi, ".update({ locale:");

const getMsgs = read('src/i18n/getMessages.ts');
includes('getMessages uses dynamic import (Vercel-safe)', getMsgs, 'await import(');
assert('getMessages does NOT use fs.readFileSync', getMsgs.includes('readFileSync'), false);

const getLoc = read('src/i18n/getLocale.ts');
includes('getLocale reads from cookies', getLoc, 'cookies()');
includes('getLocale uses LOCALE_COOKIE', getLoc, 'LOCALE_COOKIE');

const rootLayout = read('src/app/layout.tsx');
includes('Root layout uses I18nProvider', rootLayout, 'I18nProvider');
includes('Root layout passes locale to html lang', rootLayout, 'lang={locale}');

// Message files balanced
function flatKeys(obj: any, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys.push(...flatKeys(v, key));
    } else {
      keys.push(key);
    }
  }
  return keys.sort();
}
const caKeys = flatKeys(JSON.parse(read('messages/ca.json')));
const esKeys = flatKeys(JSON.parse(read('messages/es.json')));
const enKeys = flatKeys(JSON.parse(read('messages/en.json')));
assert('es.json keys match ca.json', JSON.stringify(esKeys), JSON.stringify(caKeys));
assert('en.json keys match ca.json', JSON.stringify(enKeys), JSON.stringify(caKeys));

// ============================================================
// BUG 3: TEAM
// ============================================================
console.log('\n=== BUG 3: TEAM ===');

const teamApi = read('src/app/api/team/route.ts');
includes('Team API has Strategy 1 (FK join)', teamApi, 'memberships_user_id_profiles_fk');
includes('Team API has Strategy 2 (fallback)', teamApi, 'Strategy 2');
includes('Team API fetches profiles separately', teamApi, "from('profiles')");
includes('Team API maps profileMap', teamApi, 'profileMap');

includes('Migration adds FK memberships→profiles', mig, 'memberships_user_id_profiles_fk');
includes('Migration adds profiles_select_teammates RLS', mig, 'profiles_select_teammates');
includes('Migration reloads schema cache', mig, 'reload schema');

// ============================================================
// ZERO BREAKING CHANGES
// ============================================================
console.log('\n=== ZERO BREAKING CHANGES ===');

// WorkspaceContext untouched
const ws = read('src/contexts/WorkspaceContext.tsx');
includes('WorkspaceContext intact: switchBiz', ws, 'switchBiz');
includes('WorkspaceContext intact: switchOrg', ws, 'switchOrg');

// Auth callback untouched
const auth = read('src/app/(auth)/callback/route.ts');
includes('Auth callback intact', auth, 'exchangeCodeForSession');

// Middleware intact
const mw = read('src/middleware.ts');
includes('Middleware strips locale prefix', mw, 'isLocale(firstSeg)');

console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
if (fail > 0) process.exit(1);
