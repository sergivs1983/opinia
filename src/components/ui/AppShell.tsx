'use client';

import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

export const shellTokens = {
  bg: '#fafaf9',
  white: '#ffffff',
  border: 'rgba(0,0,0,0.06)',
  borderSolid: '#e9e9e7',
  textPrimary: '#18181b',
  textSecondary: '#71717a',
  textMuted: '#a1a1aa',
  textSubtle: '#d4d4d8',
  emerald500: '#10b981',
  emerald600: '#059669',
  emerald700: '#047857',
  emerald800: '#065f46',
  emeraldFaint: 'rgba(16,185,129,0.04)',
  emeraldBorder: 'rgba(16,185,129,0.12)',
  serif: "Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  cardRadius: 32,
  cardShadow: '0 20px 60px rgba(0,0,0,0.07), 0 4px 16px rgba(0,0,0,0.04)',
  cardShadowSm: '0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
} as const;

export function AppShellGlobalStyles() {
  return (
    <style jsx global>{`
      @keyframes opiniaFloatCard { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
      @keyframes opiniaPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.88); } }
      @keyframes opiniaFadeIn { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
      @keyframes opiniaSlideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
    `}</style>
  );
}

export const ShellIcons = {
  Home: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2 7.5L9 2l7 5.5V16a1 1 0 01-1 1H3a1 1 0 01-1-1V7.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 17V11.5h5V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Calendar: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="3.5" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 8h14M6 1.5v4M12 1.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Archive: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="15" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 6v9a1 1 0 001 1h10a1 1 0 001-1V6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Settings: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Bell: () => (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M7.5 1.5C5 1.5 3 3.5 3 6v3.5l-1 1.5h11l-1-1.5V6c0-2.5-2-4.5-4.5-4.5zM6 11.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  Mic: () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="6" y="1.5" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 9.5a6 6 0 0012 0M9 15.5v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Send: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14 2L7.5 8.5M14 2L9.5 14l-2-6L2 5.5 14 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
} as const;

type ShellPageHeaderProps = {
  title: string;
  subtitle?: string;
};

export function ShellPageHeader({ title, subtitle }: ShellPageHeaderProps) {
  return (
    <header style={{ marginBottom: 40, animation: 'opiniaSlideUp 0.6s ease both' }}>
      <h1
        style={{
          fontSize: 34,
          fontWeight: 600,
          fontFamily: shellTokens.serif,
          color: shellTokens.textPrimary,
          lineHeight: 1.2,
          letterSpacing: '-0.5px',
          marginBottom: 8,
        }}
      >
        {title}
      </h1>
      {subtitle ? (
        <p style={{ fontSize: 16, color: shellTokens.textSecondary, fontWeight: 400, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}

type ShellCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  float?: boolean;
};

export function ShellCard({ children, style, float = false, ...props }: ShellCardProps) {
  return (
    <div
      {...props}
      style={{
        background: shellTokens.white,
        borderRadius: shellTokens.cardRadius,
        border: '1.5px solid rgba(255,255,255,0.9)',
        boxShadow: shellTokens.cardShadow,
        padding: '28px 28px 24px',
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
        animation: float ? 'opiniaFloatCard 4s ease-in-out infinite' : 'opiniaSlideUp 0.5s 0.1s ease both',
        ...(style as CSSProperties),
      }}
    >
      {children}
    </div>
  );
}

type ShellCardLightProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function ShellCardLight({ children, style, ...props }: ShellCardLightProps) {
  return (
    <div
      {...props}
      style={{
        background: shellTokens.white,
        borderRadius: 20,
        border: `1.5px solid ${shellTokens.borderSolid}`,
        boxShadow: shellTokens.cardShadowSm,
        padding: '20px 24px',
        width: '100%',
        ...(style as CSSProperties),
      }}
    >
      {children}
    </div>
  );
}

type ShellBadgeProps = {
  label: string;
  bg: string;
  color: string;
  dot?: string;
};

export function ShellBadge({ label, bg, color, dot }: ShellBadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: bg,
        color,
        padding: '4px 10px',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
      }}
    >
      {dot ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} /> : null}
      {label}
    </span>
  );
}

export function ShellDivider() {
  return <div style={{ height: 1, background: 'linear-gradient(90deg,#f4f4f5 0%,transparent 100%)', margin: '16px 0' }} />;
}

type ShellEmptyStateProps = {
  title: string;
  subtitle?: string;
};

export function ShellEmptyState({ title, subtitle }: ShellEmptyStateProps) {
  return (
    <ShellCardLight>
      <div style={{ padding: '10px 0', textAlign: 'center' }}>
        <p style={{ fontSize: 18, fontWeight: 600, color: shellTokens.textPrimary, fontFamily: shellTokens.serif }}>{title}</p>
        {subtitle ? <p style={{ marginTop: 8, fontSize: 14, color: shellTokens.textSecondary }}>{subtitle}</p> : null}
      </div>
    </ShellCardLight>
  );
}

type ShellCommandBarProps = {
  placeholder?: string;
  onSubmit?: (message: string) => void;
};

export function ShellCommandBar({ placeholder = 'Demana alguna cosa a LITO...', onSubmit }: ShellCommandBarProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  const submit = () => {
    const message = value.trim();
    if (!message) return;
    onSubmit?.(message);
    setValue('');
  };

  return (
    <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 80, width: 'min(560px,calc(100vw - 48px))' }}>
      <div
        style={{
          background: focused ? 'rgba(255,255,255,0.97)' : 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: focused ? '1.5px solid #d4d4d8' : '1.5px solid rgba(212,212,216,0.6)',
          borderRadius: 32,
          boxShadow: focused
            ? '0 16px 48px rgba(0,0,0,0.12),0 4px 16px rgba(0,0,0,0.06)'
            : '0 8px 32px rgba(0,0,0,0.08),0 2px 8px rgba(0,0,0,0.04)',
          padding: '10px 14px 10px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          transition: 'all 0.2s ease',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: shellTokens.emerald500,
            flexShrink: 0,
            boxShadow: '0 0 0 3px rgba(16,185,129,0.15)',
            animation: 'opiniaPulse 2s ease-in-out infinite',
          }}
        />

        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 14,
            color: shellTokens.textPrimary,
            fontFamily: shellTokens.sans,
          }}
        />

        <button
          type="button"
          aria-label="Microfon"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: '#f4f4f5',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: shellTokens.textMuted,
            flexShrink: 0,
          }}
        >
          <ShellIcons.Mic />
        </button>

        {value.trim().length > 0 ? (
          <button
            type="button"
            aria-label="Enviar"
            onClick={submit}
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: shellTokens.textPrimary,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              flexShrink: 0,
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              animation: 'opiniaFadeIn 0.15s ease',
            }}
          >
            <ShellIcons.Send />
          </button>
        ) : null}
      </div>
    </div>
  );
}
