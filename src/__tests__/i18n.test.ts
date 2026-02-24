/**
 * Tests for i18n infrastructure.
 * Run: npx tsx src/__tests__/i18n.test.ts
 */

function assertEq(label: string, actual: any, expected: any) {
  const pass = actual === expected;
  console.log(`${pass ? '✅' : '❌'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!pass) process.exitCode = 1;
}
function assertTrue(label: string, cond: boolean) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) process.exitCode = 1;
}

// === Locale resolution logic (mirrors middleware) ===
const LOCALES = ['ca', 'es', 'en'] as const;
type Locale = (typeof LOCALES)[number];
const DEFAULT: Locale = 'ca';

function isValidLocale(v: string): v is Locale {
  return LOCALES.includes(v as Locale);
}

function resolveLocale(cookie?: string, acceptLang?: string): Locale {
  if (cookie && isValidLocale(cookie)) return cookie;
  if (acceptLang) {
    for (const l of LOCALES) {
      if (acceptLang.toLowerCase().includes(l)) return l;
    }
  }
  return DEFAULT;
}

function getPathnameLocale(pathname: string): Locale | null {
  const seg = pathname.split('/')[1];
  return seg && isValidLocale(seg) ? seg : null;
}

console.log('\n=== LOCALE RESOLUTION ===');

// T1: Cookie takes priority
assertEq('Cookie es → es', resolveLocale('es', 'en-US'), 'es');

// T2: Accept-Language fallback
assertEq('No cookie, Accept en → en', resolveLocale(undefined, 'en-US,en;q=0.9'), 'en');

// T3: Default ca
assertEq('No cookie, no accept → ca', resolveLocale(), 'ca');

// T4: Invalid cookie → Accept-Language
assertEq('Bad cookie, Accept es → es', resolveLocale('fr', 'es-ES'), 'es');

// T5: Invalid everything → ca
assertEq('Bad cookie, bad accept → ca', resolveLocale('fr', 'fr-FR'), 'ca');

console.log('\n=== PATHNAME LOCALE DETECTION ===');

// T6: /ca/dashboard → ca
assertEq('/ca/dashboard → ca', getPathnameLocale('/ca/dashboard'), 'ca');

// T7: /es/settings → es
assertEq('/es/settings → es', getPathnameLocale('/es/settings'), 'es');

// T8: /en → en
assertEq('/en → en', getPathnameLocale('/en'), 'en');

// T9: /dashboard (no locale) → null
assertEq('/dashboard → null', getPathnameLocale('/dashboard'), null);

// T10: / → null
assertEq('/ → null', getPathnameLocale('/'), null);

// T11: /api/health → null (not a locale)
assertEq('/api/health → null', getPathnameLocale('/api/health'), null);

console.log('\n=== SHOULD SKIP LOCALE ===');

function shouldSkip(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return true;
  if (['/_next', '/favicon.ico'].some(p => pathname.startsWith(p))) return true;
  if (/\.(?:svg|png|jpg)$/.test(pathname)) return true;
  return false;
}

// T12: API routes skip
assertTrue('/api/health → skip', shouldSkip('/api/health'));

// T13: Static files skip
assertTrue('/_next/static → skip', shouldSkip('/_next/static/chunk.js'));

// T14: Normal page → don't skip
assertTrue('/dashboard → no skip', !shouldSkip('/dashboard'));

// T15: Landing → don't skip
assertTrue('/ → no skip', !shouldSkip('/'));

console.log('\n=== DEEP MERGE (fallback messages) ===');

function deepMerge(base: any, override: any): any {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (typeof override[key] === 'object' && override[key] !== null && !Array.isArray(override[key])) {
      result[key] = deepMerge(result[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

const base = { common: { save: 'Desar', loading: 'Carregant...' }, nav: { inbox: 'Inbox' } };
const override = { common: { save: 'Save' } };
const merged = deepMerge(base, override);

// T16: Overridden key
assertEq('Overridden key', merged.common.save, 'Save');

// T17: Fallback key
assertEq('Fallback key', merged.common.loading, 'Carregant...');

// T18: Untouched namespace
assertEq('Untouched namespace', merged.nav.inbox, 'Inbox');

console.log('\n=== MESSAGE FILES VALIDATION ===');

const fs = require('fs');
const path = require('path');

for (const locale of LOCALES) {
  const filePath = path.join(__dirname, '../../messages', `${locale}.json`);
  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    assertTrue(`${locale}.json: has common`, !!content.common);
    assertTrue(`${locale}.json: has nav`, !!content.nav);
    assertTrue(`${locale}.json: has landing`, !!content.landing);
    assertTrue(`${locale}.json: has settings`, !!content.settings);
    assertTrue(`${locale}.json: has legal`, !!content.legal);
  } catch (e: any) {
    console.log(`❌ ${locale}.json: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('\n=== ALL I18N TESTS COMPLETE ===');
