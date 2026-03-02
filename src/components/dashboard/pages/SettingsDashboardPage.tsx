'use client';

import Link from 'next/link';

import DashboardPlansPage from '@/app/dashboard/plans/page';
import LITOConfigTab from '@/components/lito/tabs/LITOConfigTab';
import LITOHealthTab from '@/components/lito/tabs/LITOHealthTab';
import { ShellCardLight, ShellPageHeader, shellTokens } from '@/components/ui/AppShell';
import SpotlightCard from '@/components/ui/SpotlightCard';

type SettingsPanel = 'config' | 'health' | 'plans';

type SettingsDashboardPageProps = {
  panel: SettingsPanel;
};

const PANELS: Array<{ key: SettingsPanel; label: string; href: string }> = [
  { key: 'config', label: 'Config', href: '/dashboard/settings?panel=config' },
  { key: 'health', label: 'Health', href: '/dashboard/settings?panel=health' },
  { key: 'plans', label: 'Plans', href: '/dashboard/settings?panel=plans' },
];

function renderPanel(panel: SettingsPanel) {
  if (panel === 'health') return <LITOHealthTab />;
  if (panel === 'plans') return <DashboardPlansPage />;
  return <LITOConfigTab />;
}

export default function SettingsDashboardPage({ panel }: SettingsDashboardPageProps) {
  return (
    <section>
      <ShellPageHeader
        title="Configuracio."
        subtitle="Integracions, salut de guardrails i entitlements del compte en un sol espai."
      />

      <SpotlightCard style={{ marginBottom: 16 }}>
        <div style={{ padding: '8px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {PANELS.map((item) => {
            const active = item.key === panel;
            return (
              <Link
                key={item.key}
                href={item.href}
                style={{
                  borderRadius: 999,
                  padding: '8px 14px',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  border: active ? `1px solid ${shellTokens.borderSolid}` : '1px solid transparent',
                  color: active ? shellTokens.textPrimary : shellTokens.textSecondary,
                  background: active ? shellTokens.white : 'transparent',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </SpotlightCard>

      {renderPanel(panel)}
    </section>
  );
}
