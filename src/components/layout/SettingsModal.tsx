'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import {
  BillingSettings,
  IntegrationsPlaceholder,
  LanguageSettings,
  VoiceSettings,
} from '@/components/settings';
import BrandBrainPanel from '@/components/lito/panels/BrandBrainPanel';
import LITOHealthTab from '@/components/lito/tabs/LITOHealthTab';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { shellTokens } from '@/components/ui/AppShell';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SettingsPanelKey =
  | 'general'
  | 'integrations'
  | 'brand-brain'
  | 'billing'
  | 'language'
  | 'health';

const ALL_PANELS: ReadonlyArray<{
  key: SettingsPanelKey;
  label: string;
  description: string;
}> = [
  {
    key: 'general',
    label: 'General',
    description: "Veu, estil de respostes i comportament de l'assistent.",
  },
  {
    key: 'integrations',
    label: 'Integracions',
    description: 'Conecta plataformes externes: Instagram, webhooks i més.',
  },
  {
    key: 'brand-brain',
    label: 'Brand Brain',
    description: 'Memòria del negoci, tó de marca i instruccions personalitzades.',
  },
  {
    key: 'billing',
    label: 'Billing',
    description: 'Pla actual, ús i gestió de pagaments.',
  },
  {
    key: 'language',
    label: 'Idioma',
    description: "Idioma d'interfície i de les respostes generades per IA.",
  },
  {
    key: 'health',
    label: 'Health',
    description: 'Estat dels guardrails, connectors i ressenyes en curs.',
  },
] as const;

function normalizePanel(value: string | null | undefined): SettingsPanelKey {
  if (
    value === 'general' ||
    value === 'integrations' ||
    value === 'brand-brain' ||
    value === 'billing' ||
    value === 'language' ||
    value === 'health'
  ) {
    return value;
  }
  return 'general';
}

// ─── Icon components (inline SVGs) ────────────────────────────────────────────

function IconGeneral() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M7.5 1v1.5m0 9V13m-6.5-5.5H2.5m9 0H13m-9.7-3.7 1 1M11.7 11.7l1 1m0-9.4-1 1M3.3 11.7l-1 1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconIntegrations() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.5" y="1.5" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.5" y="8.5" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 8.5v2m0 0v2m0-2h-2m2 0h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconBrain() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M7.5 2C5 2 3 4 3 6.5c0 1 .4 2 1 2.7V11a1 1 0 001 1h5a1 1 0 001-1V9.2c.6-.7 1-1.7 1-2.7C12 4 10 2 7.5 2z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M5.5 7.5h4M7.5 5.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconBilling() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="1" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1 6.5h13" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 9.5h2m2 0h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconLanguage() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M7.5 2c-1.5 2-2 3.5-2 5.5s.5 3.5 2 5.5m0-11c1.5 2 2 3.5 2 5.5s-.5 3.5-2 5.5M2 7.5h11"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function IconHealth() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M1.5 7.5h2l2-4 2 8 2-5 1.5 2h2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const PANEL_ICONS: Record<SettingsPanelKey, () => JSX.Element> = {
  'general': IconGeneral,
  'integrations': IconIntegrations,
  'brand-brain': IconBrain,
  'billing': IconBilling,
  'language': IconLanguage,
  'health': IconHealth,
};

// ─── Panel content ─────────────────────────────────────────────────────────────

function PanelContent({ panel }: { panel: SettingsPanelKey }) {
  const { biz, org, reload } = useWorkspace();

  if (!biz || !org) {
    return (
      <p style={{ fontSize: 14, color: shellTokens.textSecondary, lineHeight: 1.6 }}>
        Selecciona un negoci per gestionar la configuració.
      </p>
    );
  }

  switch (panel) {
    case 'general':
      return <VoiceSettings biz={biz} onSaved={reload} />;
    case 'integrations':
      return <IntegrationsPlaceholder />;
    case 'brand-brain':
      return <BrandBrainPanel bizId={biz.id ?? null} />;
    case 'billing':
      return <BillingSettings org={org} />;
    case 'language':
      return <LanguageSettings />;
    case 'health':
      return <LITOHealthTab />;
    default:
      return null;
  }
}

// ─── Close button ──────────────────────────────────────────────────────────────

function CloseButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="Tancar configuració"
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: `1.5px solid ${shellTokens.borderSolid}`,
        background: hovered ? '#f4f4f5' : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: shellTokens.textMuted,
        flexShrink: 0,
        transition: 'all 0.15s ease',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function useSettingsModal() {
  const searchParams = useSearchParams();
  const isOpen = searchParams?.get('modal') === 'settings';
  const panel = normalizePanel(searchParams?.get('panel'));
  return { isOpen, panel };
}

type SettingsModalProps = {
  onClose: () => void;
  initialPanel: SettingsPanelKey;
};

export default function SettingsModal({ onClose, initialPanel }: SettingsModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activePanel, setActivePanel] = useState<SettingsPanelKey>(initialPanel);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Sync from URL param
  useEffect(() => {
    const p = normalizePanel(searchParams?.get('panel'));
    setActivePanel(p);
  }, [searchParams]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handlePanelSelect = useCallback(
    (key: SettingsPanelKey) => {
      setActivePanel(key);
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set('modal', 'settings');
      params.set('panel', key);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  const current = ALL_PANELS.find((p) => p.key === activePanel) ?? ALL_PANELS[0]!;
  const PanelIcon = PANEL_ICONS[activePanel];

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        animation: 'opiniaFadeIn 0.18s ease both',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Configuració"
        style={{
          width: '100%',
          maxWidth: 880,
          height: 'min(680px, 85vh)',
          background: shellTokens.white,
          borderRadius: 24,
          border: `1.5px solid ${shellTokens.borderSolid}`,
          boxShadow: '0 32px 80px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.08)',
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
          animation: 'opiniaModalIn 0.22s cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        {/* ── Left sidebar nav ── */}
        <nav
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: `1px solid ${shellTokens.borderSolid}`,
            display: 'flex',
            flexDirection: 'column',
            padding: '20px 12px 20px',
            gap: 2,
            overflowY: 'auto',
          }}
        >
          <p
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: shellTokens.textMuted,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              padding: '0 10px 12px',
            }}
          >
            Configuració
          </p>
          {ALL_PANELS.map(({ key, label }) => {
            const active = key === activePanel;
            const Icon = PANEL_ICONS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => handlePanelSelect(key)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: 'none',
                  background: active ? '#f4f4f5' : 'transparent',
                  color: active ? shellTokens.textPrimary : shellTokens.textSecondary,
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  transition: 'all 0.12s ease',
                  position: 'relative',
                }}
              >
                <span
                  style={{
                    color: active ? shellTokens.emerald500 : shellTokens.textMuted,
                    display: 'flex',
                    flexShrink: 0,
                  }}
                >
                  <Icon />
                </span>
                {label}
                {active && (
                  <span
                    style={{
                      position: 'absolute',
                      right: 10,
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      background: shellTokens.emerald500,
                    }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* ── Right panel ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Panel header */}
          <div
            style={{
              padding: '20px 28px 16px',
              borderBottom: `1px solid ${shellTokens.borderSolid}`,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexShrink: 0,
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
                <span style={{ color: shellTokens.emerald500, display: 'flex' }}>
                  <PanelIcon />
                </span>
                <h2
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    fontFamily: shellTokens.serif,
                    color: shellTokens.textPrimary,
                    margin: 0,
                  }}
                >
                  {current.label}
                </h2>
              </div>
              <p style={{ fontSize: 13, color: shellTokens.textSecondary, margin: 0, lineHeight: 1.5 }}>
                {current.description}
              </p>
            </div>
            <CloseButton onClick={onClose} />
          </div>

          {/* Panel content (scrollable) */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 32px' }}>
            <PanelContent panel={activePanel} />
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes opiniaModalIn {
          from { opacity: 0; transform: scale(0.94) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
