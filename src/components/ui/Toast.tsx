'use client';

import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastCtx = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastCtx.Provider value={{ toast: addToast }}>
      {children}

      {/* Toast container — bottom-right */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              'animate-slide-up flex items-center gap-3 px-4 py-3 rounded-[var(--radius-md)] text-sm font-medium shadow-lg',
              'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
            )}
          >
            <span className="shrink-0">
              {t.type === 'success' && <span className="w-2 h-2 rounded-full bg-[var(--color-success)] inline-block" />}
              {t.type === 'error'   && <span className="w-2 h-2 rounded-full bg-[var(--color-danger)] inline-block" />}
              {t.type === 'warning' && <span className="w-2 h-2 rounded-full bg-[var(--color-warning)] inline-block" />}
              {t.type === 'info'    && <span className="w-2 h-2 rounded-full bg-[var(--color-info)] inline-block" />}
            </span>
            <span className="text-[var(--color-text)] flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] shrink-0"
              aria-label="Dismiss"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
