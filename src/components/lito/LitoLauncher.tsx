'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import LitoCommandCenter from '@/components/lito/LitoCommandCenter';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';

type LitoCopyStatusReason = 'missing_api_key' | 'paused' | 'disabled' | 'ok';

type LitoCopyStatusPayload = {
  enabled?: boolean;
  reason?: LitoCopyStatusReason;
  provider?: 'openai' | 'anthropic' | 'none';
};

export default function LitoLauncher() {
  const t = useT();
  const { biz, membership } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState<LitoCopyStatusReason>('disabled');

  const canActivate = useMemo(() => {
    const role = (membership?.role || '').toLowerCase();
    return role === 'owner' || role === 'manager' || role === 'admin';
  }, [membership?.role]);

  const loadCopyStatus = useCallback(async () => {
    if (!biz?.id) {
      setEnabled(false);
      setReason('disabled');
      return;
    }

    try {
      const response = await fetch(`/api/lito/copy/status?biz_id=${biz.id}`);
      const payload = (await response.json().catch(() => ({}))) as LitoCopyStatusPayload;
      if (!response.ok || typeof payload.enabled !== 'boolean') {
        setEnabled(false);
        setReason('disabled');
        return;
      }
      setEnabled(payload.enabled);
      setReason(payload.reason || (payload.enabled ? 'ok' : 'disabled'));
    } catch {
      setEnabled(false);
      setReason('disabled');
    }
  }, [biz?.id]);

  useEffect(() => {
    void loadCopyStatus();
  }, [loadCopyStatus]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const statusClass = enabled ? 'bg-emerald-400' : 'bg-amber-400';
  const tooltip = enabled
    ? t('dashboard.litoPage.launcher.tooltipActive')
    : t('dashboard.litoPage.launcher.tooltipInactive');

  const disabledMessage = reason === 'missing_api_key'
    ? t('dashboard.litoPage.launcher.bannerMissingKey')
    : t('dashboard.litoPage.launcher.bannerPaused');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={tooltip}
        className={cn(
          'fixed bottom-24 left-4 z-[75] inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-zinc-900/90 text-xs font-semibold tracking-wide text-white shadow-float backdrop-blur-xl transition-all duration-200 ease-premium hover:scale-[1.02] hover:bg-zinc-800/95 md:bottom-6 md:left-6',
        )}
      >
        <span className={cn('absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border border-zinc-900', statusClass)} />
        LITO
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90]">
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
            aria-label={t('common.close')}
            onClick={() => setOpen(false)}
          />
          <aside className="absolute bottom-0 left-0 top-0 w-[min(92vw,520px)] border-r border-white/10 bg-zinc-950/95 p-4 shadow-[24px_0_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className={cn('text-base font-semibold tracking-wide', textMain)}>
                  {t('dashboard.litoPage.launcher.drawerTitle')}
                </h2>
                <p className={cn('mt-1 text-xs', textSub)}>{t('dashboard.litoPage.launcher.drawerSubtitle')}</p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => setOpen(false)}
                aria-label={t('common.close')}
              >
                ×
              </button>
            </div>

            {!enabled ? (
              <div className="mb-4 rounded-xl border border-amber-300/30 bg-amber-500/10 p-3">
                <p className="text-sm font-semibold text-amber-100">{t('dashboard.litoPage.launcher.bannerTitle')}</p>
                <p className="mt-1 text-xs text-amber-100/90">{disabledMessage}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {canActivate ? (
                    <Link
                      href="/dashboard/admin"
                      className="inline-flex items-center rounded-lg border border-amber-200/35 bg-amber-200/20 px-2.5 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-200/30"
                    >
                      {t('dashboard.litoPage.launcher.goToSettings')}
                    </Link>
                  ) : (
                    <span className="text-xs font-medium text-amber-100/90">
                      {t('dashboard.litoPage.launcher.ownerManagerOnly')}
                    </span>
                  )}
                </div>
              </div>
            ) : null}

            <div className="h-[calc(100%-88px)] overflow-y-auto pr-1">
              <LitoCommandCenter embedded />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
