'use client';

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { isLocale, type Locale } from '@/i18n/config';
import { getClientMessages } from '@/i18n/clientMessages';

type Messages = Record<string, unknown>;

interface I18nContextValue {
  locale: Locale;
  messages: Messages;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const I18nCtx = createContext<I18nContextValue>({
  locale: 'ca',
  messages: {},
  t: (key) => key,
  setLocale: () => {},
});

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Messages;
  children: ReactNode;
}) {
  const initialLocale: Locale = isLocale(locale) ? locale : 'ca';
  const [runtimeLocale, setRuntimeLocale] = useState<Locale>(initialLocale);
  const [runtimeMessages, setRuntimeMessages] = useState<Messages>(messages);

  useEffect(() => {
    const nextLocale: Locale = isLocale(locale) ? locale : 'ca';
    setRuntimeLocale(nextLocale);
    setRuntimeMessages(messages);
  }, [locale, messages]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setRuntimeLocale(nextLocale);
    setRuntimeMessages(getClientMessages(nextLocale));
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      // Navigate nested keys: "dashboard.inbox.title" → messages.dashboard.inbox.title
      const parts = key.split('.');
      let val: unknown = runtimeMessages;
      for (const p of parts) {
        if (val && typeof val === 'object') {
          val = (val as Record<string, unknown>)[p];
        } else {
          val = undefined;
          break;
        }
      }
      if (typeof val !== 'string') return key; // fallback: show key

      // Variable interpolation: {name} → vars.name
      if (vars) {
        return val.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
      }
      return val;
    },
    [runtimeMessages]
  );

  const contextValue = useMemo<I18nContextValue>(
    () => ({
      locale: runtimeLocale,
      messages: runtimeMessages,
      t,
      setLocale,
    }),
    [runtimeLocale, runtimeMessages, t, setLocale],
  );

  return (
    <I18nCtx.Provider value={contextValue}>
      {children}
    </I18nCtx.Provider>
  );
}

/** Hook to get t() and current locale */
export function useT() {
  const ctx = useContext(I18nCtx);
  return ctx.t;
}

export function useLocale() {
  return useContext(I18nCtx).locale;
}

export function useI18n() {
  return useContext(I18nCtx);
}
