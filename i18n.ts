import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale, locales, type Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/getMessages';

export { defaultLocale, locales };

export default getRequestConfig(async ({ locale }) => {
  const resolvedLocale: Locale = locale && isLocale(locale) ? locale : defaultLocale;
  const messages = await getMessages(resolvedLocale);

  return {
    locale: resolvedLocale,
    messages,
  };
});

