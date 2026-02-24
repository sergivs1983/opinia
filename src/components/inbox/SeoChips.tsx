'use client';

import Chip from '@/components/ui/Chip';
import { useT } from '@/components/i18n/I18nContext';
import AggressivenessIndicator from '@/components/inbox/AggressivenessIndicator';
import { cn } from '@/lib/utils';
import { textMuted } from '@/components/ui/glass';

interface SeoChipsProps {
  enabled: boolean;
  aggressiveness: number;
  keywords: string[];
}

export default function SeoChips({ enabled, aggressiveness, keywords }: SeoChipsProps) {
  const t = useT();

  if (!enabled) {
    return (
      <div className="flex items-center gap-2">
        <Chip active={false}>{t('dashboard.inbox.seoOff')}</Chip>
        <span className={cn('text-xs', textMuted)}>{t('dashboard.inbox.seoDisabled')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip active>{t('dashboard.inbox.seoOn')}</Chip>
      <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-2.5 py-1">
        <span className="text-[11px] font-medium text-white/72">{t('dashboard.inbox.aggressiveness')}</span>
        <AggressivenessIndicator level={aggressiveness} />
      </div>
      {keywords.slice(0, 3).map((keyword) => (
        <Chip key={keyword} active={false}>
          #{keyword}
        </Chip>
      ))}
    </div>
  );
}
