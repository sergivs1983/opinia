'use client';

import { useEffect, useMemo } from 'react';

import {
  BillingSettings,
  BusinessMemorySettings,
  IntegrationsPlaceholder,
  LanguageSettings,
  VoiceSettings,
} from '@/components/settings';
import LITOHealthTab from '@/components/lito/tabs/LITOHealthTab';
import { shellTokens } from '@/components/ui/AppShell';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export type SettingsModalPanel =
  | 'general'
  | 'integrations'
  | 'brand-brain'
  | 'billing'
  | 'language'
  | 'health';

type SettingsModalProps = {
  panel: SettingsModalPanel;
  onClose: () => void;
  onSelectPanel: (panel: SettingsModalPanel) => void;
};

type PanelItem = {
  key: SettingsModalPanel;
  label: string;
  navDescription: string;
  title: string;
  description: string;
};

const PANEL_ITEMS: PanelItem[] = [
  {
    key: 'general',
    label: 'General',
    navDescription: 'To i comportament de la IA',
    title: 'Configuració general',
    description: 'Ajusta veu, estils i paràmetres base de LITO.',
  },
  {
    key: 'integrations',
    label: 'Integracions',
    navDescription: 'Google Business i connectors',
    title: 'Integracions',
    description: 'Connecta Google Business i fluxos externs.',
  },
  {
    key: 'brand-brain',
    label: 'Brand Brain',
    navDescription: 'Memòria de negoci i context',
    title: 'Brand Brain',
    description: 'Context operatiu perquè la IA respongui com el negoci.',
  },
  {
    key: 'billing',
    label: 'Billing',
    navDescription: 'Pla i ús actual',
    title: 'Billing i plans',
    description: 'Consum, límits i estat de facturació.',
  },
  {
    key: 'language',
    label: 'Idioma',
    navDescription: 'Llengua de la plataforma',
    title: 'Idioma',
    description: 'Canvia l’idioma de la interfície.',
  },
  {
    key: 'health',
    label: 'Health',
    navDescription: 'KPI i guardrails',
    title: 'Health',
    description: 'Telemetria i guardrails operatius.',
  },
];

export function normalizeSettingsModalPanel(value: string | null | undefined): SettingsModalPanel {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'integrations') return 'integrations';
  if (normalized === 'brand-brain' || normalized === 'brand_brain' || normalized === 'brandbrain' || normalized === 'kb') {
    return 'brand-brain';
  }
  if (normalized === 'billing' || normalized === 'plans' || normalized === 'plan') return 'billing';
  if (normalized === 'language' || normalized === 'lang') return 'language';
  if (normalized === 'health') return 'health';
  return 'general';
}

export default function SettingsModal({ panel, onClose, onSelectPanel }: SettingsModalProps) {
  const { biz, org, reload } = useWorkspace();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const panelMeta = useMemo(() => {
    return PANEL_ITEMS.find((item) => item.key === panel) || PANEL_ITEMS[0];
  }, [panel]);

  const renderPanel = () => {
    if (!biz || !org) {
      return (
        <div
          style={{
            borderRadius: 20,
            border: `1px solid ${shellTokens.borderSolid}`,
            background: shellTokens.white,
            padding: 24,
          }}
        >
          Selecciona un negoci per obrir configuració avançada.
        </div>
      );
    }

    if (panel === 'integrations') return <IntegrationsPlaceholder />;
    if (panel === 'brand-brain') return <BusinessMemorySettings biz={biz} org={org} />;
    if (panel === 'billing') return <BillingSettings org={org} />;
    if (panel === 'language') return <LanguageSettings />;
    if (panel === 'health') return <LITOHealthTab />;
    return <VoiceSettings biz={biz} onSaved={reload} />;
  };

  return (
    <div
      aria-modal="true"
      role="dialog"
      aria-label="Configuració"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 140,
        background: 'rgba(9,11,16,0.46)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(920px, calc(100vw - 48px))',
          maxHeight: '80vh',
          background: shellTokens.bg,
          borderRadius: 24,
          border: `1px solid ${shellTokens.borderSolid}`,
          boxShadow: '0 24px 70px rgba(0,0,0,0.22)',
          display: 'grid',
          gridTemplateColumns: '240px minmax(0,1fr)',
          overflow: 'hidden',
        }}
      >
        <aside
          style={{
            borderRight: `1px solid ${shellTokens.borderSolid}`,
            background: shellTokens.white,
            padding: 16,
            overflowY: 'auto',
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <p
              style={{
                margin: 0,
                fontSize: 18,
                lineHeight: 1.2,
                fontWeight: 600,
                color: shellTokens.textPrimary,
                fontFamily: shellTokens.serif,
              }}
            >
              Configuració
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: shellTokens.textSecondary }}>
              Patró modal tipus ChatGPT
            </p>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {PANEL_ITEMS.map((item) => {
              const active = item.key === panel;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelectPanel(item.key)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    borderRadius: 12,
                    border: active ? `1px solid ${shellTokens.borderSolid}` : '1px solid transparent',
                    background: active ? '#f4f4f5' : 'transparent',
                    color: shellTokens.textPrimary,
                    padding: '10px 12px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: shellTokens.textSecondary }}>{item.navDescription}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <header
            style={{
              minHeight: 68,
              borderBottom: `1px solid ${shellTokens.borderSolid}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px 10px 20px',
              background: 'rgba(250,250,249,0.92)',
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: shellTokens.textPrimary }}>
                {panelMeta.title}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: shellTokens.textSecondary }}>
                {panelMeta.description}
              </p>
            </div>
            <button
              type="button"
              aria-label="Tancar configuració"
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: `1px solid ${shellTokens.borderSolid}`,
                background: shellTokens.white,
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
                color: shellTokens.textSecondary,
              }}
            >
              ×
            </button>
          </header>

          <div
            className="lito-light-scope"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: 20,
            }}
          >
            {renderPanel()}
          </div>
        </section>
      </div>
    </div>
  );
}
