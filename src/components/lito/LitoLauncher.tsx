'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';

type LitoCopyStatusPayload = {
  enabled?: boolean;
  provider?: 'openai' | 'anthropic' | 'none';
};

type WeeklyRecommendationsPayload = {
  items?: unknown[];
};

type ThreadsPayload = {
  threads?: unknown[];
};

export default function LitoLauncher() {
  const t = useT();
  const router = useRouter();
  const { biz } = useWorkspace();
  const [enabled, setEnabled] = useState(false);
  const [hasAttention, setHasAttention] = useState(false);

  const loadCopyStatus = useCallback(async () => {
    if (!biz?.id) {
      setEnabled(false);
      return;
    }

    try {
      const response = await fetch(`/api/lito/copy/status?biz_id=${biz.id}`);
      const payload = (await response.json().catch(() => ({}))) as LitoCopyStatusPayload;
      if (!response.ok || typeof payload.enabled !== 'boolean') {
        setEnabled(false);
        return;
      }
      setEnabled(payload.enabled);
    } catch {
      setEnabled(false);
    }
  }, [biz?.id]);

  const loadAttentionState = useCallback(async () => {
    if (!biz?.id) {
      setHasAttention(false);
      return;
    }
    try {
      const [weeklyRes, threadsRes] = await Promise.all([
        fetch(`/api/recommendations/weekly?biz_id=${biz.id}`),
        fetch(`/api/lito/threads?biz_id=${biz.id}&limit=20`),
      ]);
      if (!weeklyRes.ok || !threadsRes.ok) {
        setHasAttention(false);
        return;
      }
      const weeklyPayload = (await weeklyRes.json().catch(() => ({}))) as WeeklyRecommendationsPayload;
      const threadsPayload = (await threadsRes.json().catch(() => ({}))) as ThreadsPayload;
      const weeklyCount = Array.isArray(weeklyPayload.items) ? weeklyPayload.items.length : 0;
      const threadsCount = Array.isArray(threadsPayload.threads) ? threadsPayload.threads.length : 0;
      setHasAttention(weeklyCount > 0 || threadsCount > 0);
    } catch {
      setHasAttention(false);
    }
  }, [biz?.id]);

  useEffect(() => {
    void loadCopyStatus();
    void loadAttentionState();
  }, [loadAttentionState, loadCopyStatus]);

  const statusClass = hasAttention ? 'bg-amber-400' : (enabled ? 'bg-emerald-400' : 'bg-amber-400');
  const tooltip = hasAttention
    ? t('dashboard.litoPage.launcher.tooltipPending')
    : enabled
    ? t('dashboard.litoPage.launcher.tooltipActive')
    : t('dashboard.litoPage.launcher.tooltipInactive');

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const params = new URLSearchParams();
          if (biz?.id) params.set('biz_id', biz.id);
          router.push(params.toString() ? `/dashboard/lito/chat?${params.toString()}` : '/dashboard/lito/chat');
        }}
        title={tooltip}
        className={cn(
          'fixed bottom-24 left-4 z-[75] inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-zinc-900/90 text-xs font-semibold tracking-wide text-white shadow-float backdrop-blur-xl transition-all duration-200 ease-premium hover:scale-[1.02] hover:bg-zinc-800/95 md:bottom-6 md:left-6',
        )}
      >
        <span className={cn('absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border border-zinc-900', statusClass)} />
        LITO
      </button>
    </>
  );
}
