import ca from '../../messages/ca.json';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { defaultLocale, type Locale } from './config';

type Messages = Record<string, unknown>;

const CATALOG: Record<Locale, Messages> = {
  ca: ca as Messages,
  es: es as Messages,
  en: en as Messages,
};

function deepMerge(base: Messages, override: Messages): Messages {
  const result: Messages = { ...base };
  for (const key of Object.keys(override)) {
    const baseValue = base[key];
    const overrideValue = override[key];
    if (
      typeof overrideValue === 'object' &&
      overrideValue !== null &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === 'object' &&
      baseValue !== null &&
      !Array.isArray(baseValue)
    ) {
      result[key] = deepMerge(baseValue as Messages, overrideValue as Messages);
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
}

export function getClientMessages(locale: Locale): Messages {
  const localized = CATALOG[locale];
  if (!localized) return CATALOG[defaultLocale];
  if (locale === defaultLocale) return localized;
  return deepMerge(CATALOG[defaultLocale], localized);
}
