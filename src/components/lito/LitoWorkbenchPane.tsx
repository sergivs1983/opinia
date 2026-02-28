'use client';

import { textMain, textSub } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import type { LitoQuotaState, LitoRecommendationItem, LitoViewerRole } from '@/components/lito/types';

type LitoWorkbenchPaneProps = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  bizId: string | null;
  recommendation: LitoRecommendationItem | null;
  viewerRole: LitoViewerRole;
  selectedFormat: 'post' | 'story' | 'reel';
  onQuotaChange: (quota: LitoQuotaState | null) => void;
  onPublished: (recommendationId: string) => Promise<void>;
};

export default function LitoWorkbenchPane({
  t,
  recommendation,
}: LitoWorkbenchPaneProps) {
  return (
    <section className="flex min-h-[70vh] flex-col rounded-2xl border border-white/10 bg-zinc-900/45 backdrop-blur-md">
      <header className="border-b border-white/10 px-4 py-3">
        <h2 className={cn('text-sm font-semibold tracking-wide', textMain)}>{t('dashboard.litoPage.workbench.title')}</h2>
        <p className={cn('mt-1 text-xs', textSub)}>
          {recommendation ? recommendation.hook : t('dashboard.litoPage.workbench.emptyTitle')}
        </p>
      </header>
      <div className="flex-1 px-4 py-3">
        <p className={cn('rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm', textSub)}>
          {t('dashboard.litoPage.workbench.selectRecommendation')}
        </p>
      </div>
    </section>
  );
}
