import { NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import { defaultLocale, isLocale, type Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/getMessages';

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const locale: Locale = isLocale(params.locale) ? params.locale : defaultLocale;
  if (!isLocale(params.locale)) {
    notFound();
  }

  const messages = await getMessages(locale);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

