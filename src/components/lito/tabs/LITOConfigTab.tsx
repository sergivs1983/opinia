'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import {
  ActionTriggersSettings,
  BillingSettings,
  BusinessMemorySettings,
  GrowthSettings,
  IntegrationsPlaceholder,
  LanguageSettings,
  SafetySettings,
  TeamSettings,
  VoiceSettings,
} from '@/components/settings';
import LitoCard from '@/components/ui/LitoCard';
import PageHeader from '@/components/ui/PageHeader';
import Section from '@/components/ui/Section';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { tokens, cx } from '@/lib/design/tokens';

type ConfigSection =
  | 'integrations'
  | 'voice'
  | 'kb'
  | 'billing'
  | 'growth'
  | 'safety'
  | 'triggers'
  | 'team'
  | 'language';

type ConfigTabItem = {
  key: ConfigSection;
  label: string;
};

const CONFIG_SECTIONS: ConfigTabItem[] = [
  { key: 'integrations', label: 'Integracions' },
  { key: 'voice', label: 'Veu IA' },
  { key: 'kb', label: 'Brand Brain' },
  { key: 'billing', label: 'Billing' },
  { key: 'growth', label: 'Growth' },
  { key: 'safety', label: 'Safety' },
  { key: 'triggers', label: 'Triggers' },
  { key: 'team', label: 'Equip' },
  { key: 'language', label: 'Idioma' },
];

function normalizeSection(value: string | null | undefined): ConfigSection {
  if (!value) return 'integrations';
  const lower = value.toLowerCase();
  if (lower === 'lang') return 'language';
  if (lower === 'knowledge' || lower === 'knowledge_base' || lower === 'brand' || lower === 'brand_brain') return 'kb';
  if (lower === 'integrations' || lower === 'voice' || lower === 'kb' || lower === 'billing' || lower === 'growth' || lower === 'safety' || lower === 'triggers' || lower === 'team' || lower === 'language') {
    return lower as ConfigSection;
  }
  return 'integrations';
}

export default function LITOConfigTab() {
  const { biz, org, reload } = useWorkspace();
  const searchParams = useSearchParams();
  const sectionFromQuery = normalizeSection(searchParams?.get('section'));
  const [activeSection, setActiveSection] = useState<ConfigSection>(sectionFromQuery);

  useEffect(() => {
    setActiveSection(sectionFromQuery);
  }, [sectionFromQuery]);

  const title = useMemo(() => (biz?.name ? `Config · ${biz.name}` : 'Config'), [biz?.name]);

  if (!biz || !org) {
    return (
      <section className="space-y-4 pb-12" data-testid="lito-config-tab">
        <PageHeader
          title="Config"
          subtitle="Selecciona un negoci per gestionar configuració i integracions."
        />
      </section>
    );
  }

  return (
    <section className="lito-light-scope space-y-4 pb-12" data-testid="lito-config-tab">
      <PageHeader
        title={title}
        subtitle="Integracions, Brand Brain, seguretat i configuració operativa."
      />

      <Section title="Seccions">
        <div className="flex flex-wrap gap-2">
          {CONFIG_SECTIONS.map((item) => {
            const isActive = item.key === activeSection;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveSection(item.key)}
                className={cx(
                  'px-3 py-2 text-sm',
                  tokens.radius.button,
                  isActive ? cx(tokens.nav.itemActive, tokens.border.default) : cx(tokens.nav.itemIdle, tokens.border.subtle),
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </Section>

      <LitoCard spotlight={false} className="p-4 md:p-5">
        {activeSection === 'integrations' ? <IntegrationsPlaceholder /> : null}
        {activeSection === 'voice' ? <VoiceSettings biz={biz} onSaved={reload} /> : null}
        {activeSection === 'kb' ? <BusinessMemorySettings biz={biz} org={org} /> : null}
        {activeSection === 'billing' ? <BillingSettings org={org} /> : null}
        {activeSection === 'growth' ? <GrowthSettings biz={biz} org={org} /> : null}
        {activeSection === 'safety' ? <SafetySettings biz={biz} org={org} onSaved={reload} /> : null}
        {activeSection === 'triggers' ? <ActionTriggersSettings biz={biz} org={org} /> : null}
        {activeSection === 'team' ? <TeamSettings org={org} /> : null}
        {activeSection === 'language' ? <LanguageSettings /> : null}
      </LitoCard>
    </section>
  );
}
