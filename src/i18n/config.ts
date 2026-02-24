export const locales = ['ca', 'es', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ca';
export const LOCALE_COOKIE = 'opinia_locale';

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
