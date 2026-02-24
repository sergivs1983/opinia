import { cookies } from 'next/headers';
import { type Locale, defaultLocale, isLocale, LOCALE_COOKIE } from './config';

/**
 * Server-side locale resolution.
 * Priority: cookie > default.
 * DB sync happens via the /api/user/locale endpoint (called by LanguageSwitcher).
 */
export function getLocale(): Locale {
  const cookieStore = cookies();
  const value = cookieStore.get(LOCALE_COOKIE)?.value;
  if (value && isLocale(value)) return value;
  return defaultLocale;
}
