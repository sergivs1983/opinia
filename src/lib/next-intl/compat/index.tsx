'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

type Messages = Record<string, unknown>;

type IntlContextValue = {
  locale: string;
  messages: Messages;
};

const IntlCtx = createContext<IntlContextValue>({
  locale: 'ca',
  messages: {},
});

function getNestedValue(messages: Messages, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = messages;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function formatMessage(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(values[token] ?? `{{${token}}}`))
    .replace(/\{(\w+)\}/g, (_, token: string) => String(values[token] ?? `{${token}}`));
}

export function NextIntlClientProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Messages;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <IntlCtx.Provider value={value}>{children}</IntlCtx.Provider>;
}

export function useTranslations(namespace?: string) {
  const { messages } = useContext(IntlCtx);

  return useCallback((key: string, values?: Record<string, string | number>) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    const resolved = getNestedValue(messages, fullKey);
    if (typeof resolved !== 'string') return fullKey;
    return formatMessage(resolved, values);
  }, [messages, namespace]);
}

export function useLocale() {
  return useContext(IntlCtx).locale;
}

