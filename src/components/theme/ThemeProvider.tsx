'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeCtx = createContext<ThemeContextValue>({
  theme: 'light',
  resolved: 'light',
  setTheme: () => {},
  toggle: () => {},
});

function applyLightToDOM() {
  const root = document.documentElement;
  root.classList.remove('dark');
  root.classList.add('light');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme] = useState<Theme>('light');
  const [resolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    applyLightToDOM();
  }, []);

  const setTheme = useCallback(() => {
    applyLightToDOM();
  }, []);

  const toggle = useCallback(() => {
    applyLightToDOM();
  }, []);

  return (
    <ThemeCtx.Provider value={{ theme, resolved, setTheme, toggle }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx);
}
