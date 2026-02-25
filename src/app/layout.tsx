import type { Metadata } from 'next';
// next/font/google removed: it fetches Inter at build time from Google Fonts, which
// fails in offline/local environments. --font-inter is now defined as a CSS custom
// property in globals.css (font-family stack with Inter + system fallbacks, no fetch).
import './globals.css';
import { getLocale } from '@/i18n/getLocale';
import { getMessages } from '@/i18n/getMessages';
import { I18nProvider } from '@/components/i18n/I18nContext';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'OpinIA – Respostes professionals amb IA per al teu negoci',
  description: 'Genera respostes professionals amb IA a ressenyes de restaurants, hotels i apartaments.',
  openGraph: {
    title: 'OpinIA',
    description: 'Respostes professionals amb IA per al teu negoci.',
    images: [{ url: '/brand/logo.png' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/brand/logo.png'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', type: 'image/x-icon' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages(locale);

  return (
    <html lang={locale} className="scroll-smooth" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <I18nProvider locale={locale} messages={messages}>
            <ToastProvider>
              <div className="opinia-bg min-h-screen text-white/90">{children}</div>
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}