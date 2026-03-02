'use client';

import { useEffect, useMemo } from 'react';
import {
  Activity,
  Brain,
  CreditCard,
  Globe2,
  PlugZap,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react';

import {
  BillingSettings,
  BusinessMemorySettings,
  IntegrationsPlaceholder,
  LanguageSettings,
  VoiceSettings,
} from '@/components/settings';
import LITOHealthTab from '@/components/lito/tabs/LITOHealthTab';
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
  Icon: LucideIcon;
  label: string;
  navDescription: string;
  title: string;
  description: string;
};

const PANEL_ITEMS: PanelItem[] = [
  {
    key: 'general',
    Icon: SlidersHorizontal,
    label: 'General',
    navDescription: 'To i comportament de la IA',
    title: 'Configuració general',
    description: 'Ajusta veu, estils i paràmetres base de LITO.',
  },
  {
    key: 'integrations',
    Icon: PlugZap,
    label: 'Integracions',
    navDescription: 'Google Business i connectors',
    title: 'Integracions',
    description: 'Connecta Google Business i fluxos externs.',
  },
  {
    key: 'brand-brain',
    Icon: Brain,
    label: 'Brand Brain',
    navDescription: 'Memòria de negoci i context',
    title: 'Brand Brain',
    description: 'Context operatiu perquè la IA respongui com el negoci.',
  },
  {
    key: 'billing',
    Icon: CreditCard,
    label: 'Billing',
    navDescription: 'Pla i ús actual',
    title: 'Billing i plans',
    description: 'Consum, límits i estat de facturació.',
  },
  {
    key: 'language',
    Icon: Globe2,
    label: 'Idioma',
    navDescription: 'Llengua de la plataforma',
    title: 'Idioma',
    description: 'Canvia l’idioma de la interfície.',
  },
  {
    key: 'health',
    Icon: Activity,
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
        <div className="rounded-2xl border border-black/10 bg-white p-6 text-sm text-zinc-700 shadow-sm">
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
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/25 p-4 backdrop-blur-md sm:p-6"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="grid max-h-[80vh] w-full max-w-[920px] grid-cols-1 overflow-hidden rounded-2xl border border-black/10 bg-white/90 shadow-2xl backdrop-blur-xl md:grid-cols-[16rem_minmax(0,1fr)]"
      >
        <aside
          className="overflow-hidden border-b border-black/10 bg-zinc-50/80 p-4 md:border-b-0 md:border-r md:p-5"
        >
          <div>
            <p className="font-serif text-[28px] font-semibold leading-tight tracking-[-0.02em] text-zinc-900">Configuració</p>
            <p className="mt-1 text-xs text-zinc-500">Gestiona el comportament i les fonts de context de LITO.</p>
          </div>

          <nav className="mt-4 flex flex-col gap-1.5">
            {PANEL_ITEMS.map((item) => {
              const active = item.key === panel;
              const Icon = item.Icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelectPanel(item.key)}
                  className={[
                    'w-full rounded-xl border px-3 py-2.5 text-left transition',
                    active
                      ? 'border-black/10 bg-white shadow-sm'
                      : 'border-transparent bg-transparent hover:border-black/5 hover:bg-white/70',
                  ].join(' ')}
                >
                  <span className="flex items-start gap-2.5">
                    <Icon
                      size={16}
                      className={active ? 'mt-0.5 text-zinc-900' : 'mt-0.5 text-zinc-500'}
                      aria-hidden="true"
                    />
                    <span>
                      <span className="block text-[13px] font-semibold leading-tight text-zinc-900">{item.label}</span>
                      <span className="mt-1 block text-[11px] leading-tight text-zinc-500">{item.navDescription}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="min-h-0 min-w-0 overflow-hidden">
          <div className="min-h-0 h-full overflow-y-auto">
            <header
              className="sticky top-0 z-20 flex min-h-[72px] items-start justify-between border-b border-black/10 bg-white/95 px-5 py-3 backdrop-blur md:items-center md:px-6"
            >
              <div>
                <p className="text-[15px] font-semibold text-zinc-900">{panelMeta.title}</p>
                <p className="mt-1 text-xs text-zinc-500">{panelMeta.description}</p>
              </div>
              <button
                type="button"
                aria-label="Tancar configuració"
                onClick={onClose}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-800"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="lito-light-scope space-y-4 p-5 md:p-6">
              {renderPanel()}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
