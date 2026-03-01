'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useT, useLocale } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';

type SocialDraftStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'published';

type SocialDraftReviewItem = {
  id: string;
  org_id: string;
  biz_id: string;
  recommendation_id: string | null;
  status: SocialDraftStatus;
  channel: 'instagram' | 'tiktok' | 'facebook';
  format: 'post' | 'story' | 'reel';
  title: string | null;
  copy_short: string | null;
  copy_long: string | null;
  hashtags: string[] | null;
  created_by: string;
  review_note: string | null;
  rejection_note?: string | null;
  version: number;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  updated_at: string;
};

type SocialDraftInboxPayload = {
  ok?: boolean;
  items?: SocialDraftReviewItem[];
  error?: string;
  message?: string;
};

type SocialDraftMutationPayload = {
  ok?: boolean;
  draft?: SocialDraftReviewItem;
  error?: string;
  message?: string;
};

export default function LitoReviewPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const { biz, businesses, switchBiz } = useWorkspace();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SocialDraftReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copyShort, setCopyShort] = useState('');
  const [copyLong, setCopyLong] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const [publishing, setPublishing] = useState(false);

  const queryBizId = searchParams.get('biz_id');
  const queryDraftId = searchParams.get('draft_id');

  const selectedDraft = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );

  const loadInbox = useCallback(async () => {
    if (!biz?.id || !biz.org_id) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/social/drafts/inbox?org_id=${biz.org_id}&biz_id=${biz.id}&status=pending&limit=30`);
      const payload = (await response.json().catch(() => ({}))) as SocialDraftInboxPayload;
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.litoPage.review.loadError'));
      }

      const nextItems = payload.items || [];
      setItems(nextItems);

      if (queryDraftId && nextItems.some((item) => item.id === queryDraftId)) {
        setSelectedId(queryDraftId);
      } else {
        setSelectedId((current) => {
          if (current && nextItems.some((item) => item.id === current)) return current;
          return nextItems[0]?.id || null;
        });
      }
    } catch (error) {
      setItems([]);
      setSelectedId(null);
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.review.loadError');
      toast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [biz?.id, biz?.org_id, queryDraftId, t, toast]);

  useEffect(() => {
    if (!biz?.id || !queryBizId || queryBizId === biz.id) return;
    if (businesses.some((entry) => entry.id === queryBizId)) {
      void switchBiz(queryBizId);
    }
  }, [biz?.id, businesses, queryBizId, switchBiz]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (!selectedDraft) {
      setCopyShort('');
      setCopyLong('');
      setHashtagsText('');
      setRejectNote('');
      return;
    }
    setCopyShort(selectedDraft.copy_short || '');
    setCopyLong(selectedDraft.copy_long || '');
    setHashtagsText((selectedDraft.hashtags || []).join(' '));
    setRejectNote(selectedDraft.review_note || '');
  }, [selectedDraft]);

  const approveDraft = useCallback(async () => {
    if (!selectedDraft) return;
    setActing('approve');
    try {
      const response = await fetch(`/api/social/drafts/${selectedDraft.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: selectedDraft.version,
          copy_short: copyShort || null,
          copy_long: copyLong || null,
          hashtags: hashtagsText
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as SocialDraftMutationPayload;
      if (!response.ok || payload.error || !payload.draft) {
        throw new Error(payload.message || t('dashboard.litoPage.approval.approveError'));
      }

      setItems((previous) => previous.map((item) => (
        item.id === selectedDraft.id ? payload.draft as SocialDraftReviewItem : item
      )));
      toast(t('dashboard.litoPage.approval.approveSuccess'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.approval.approveError');
      toast(message, 'error');
    } finally {
      setActing(null);
    }
  }, [copyLong, copyShort, hashtagsText, selectedDraft, t, toast]);

  const rejectDraft = useCallback(async () => {
    if (!selectedDraft) return;
    setActing('reject');
    try {
      const response = await fetch(`/api/social/drafts/${selectedDraft.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: selectedDraft.version,
          note: rejectNote.trim() || t('dashboard.litoPage.approval.rejectDefaultNote'),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as SocialDraftMutationPayload;
      if (!response.ok || payload.error || !payload.draft) {
        throw new Error(payload.message || t('dashboard.litoPage.approval.rejectError'));
      }

      setItems((previous) => previous.map((item) => (
        item.id === selectedDraft.id ? payload.draft as SocialDraftReviewItem : item
      )));
      toast(t('dashboard.litoPage.approval.rejectSuccess'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.approval.rejectError');
      toast(message, 'error');
    } finally {
      setActing(null);
    }
  }, [rejectNote, selectedDraft, t, toast]);

  const copyApproved = useCallback(async () => {
    if (!copyLong.trim()) return;
    try {
      await navigator.clipboard.writeText(copyLong.trim());
      toast(t('dashboard.home.recommendations.lito.copySuccess'), 'success');
    } catch {
      toast(t('dashboard.home.recommendations.lito.copyError'), 'error');
    }
  }, [copyLong, t, toast]);

  const publishDraft = useCallback(async () => {
    if (!selectedDraft || selectedDraft.status !== 'approved') return;
    setPublishing(true);
    try {
      const response = await fetch(`/api/social/drafts/${selectedDraft.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: selectedDraft.version }),
      });
      const payload = (await response.json().catch(() => ({}))) as SocialDraftMutationPayload;
      if (!response.ok || payload.error || !payload.draft) {
        throw new Error(payload.message || t('dashboard.litoPage.approval.publishError'));
      }
      setItems((previous) => previous.map((item) => (
        item.id === selectedDraft.id ? payload.draft as SocialDraftReviewItem : item
      )));
      toast(t('dashboard.litoPage.approval.publishSuccess'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.approval.publishError');
      toast(message, 'error');
    } finally {
      setPublishing(false);
    }
  }, [selectedDraft, t, toast]);

  if (!biz) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <GlassCard variant="strong" className="w-full max-w-xl p-8 text-center">
          <p className={cn('text-sm', textSub)}>{t('dashboard.metrics.selectBusiness')}</p>
          <Button className="mt-4" onClick={() => router.push('/dashboard')}>
            {t('dashboard.home.navHome')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="lito-review-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={cn('text-2xl font-semibold tracking-tight', textMain)}>{t('dashboard.litoPage.review.title')}</h1>
          <p className={cn('mt-1 text-sm', textSub)}>{t('dashboard.litoPage.review.subtitle')}</p>
        </div>
        <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => router.push(`/dashboard/lito?biz_id=${biz.id}`)}>
          {t('dashboard.litoPage.review.backToLito')}
        </Button>
      </header>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <GlassCard variant="strong" className="p-3">
          <p className={cn('text-xs font-semibold uppercase tracking-wide text-white/65')}>{t('dashboard.litoPage.review.pendingTitle')}</p>
          <div className="mt-3 space-y-2">
            {loading ? (
              <>
                <div className="h-12 animate-pulse rounded-lg border border-white/8 bg-white/6" />
                <div className="h-12 animate-pulse rounded-lg border border-white/8 bg-white/6" />
              </>
            ) : items.length > 0 ? (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-all duration-200 ease-premium',
                    selectedId === item.id
                      ? 'border-emerald-300/35 bg-emerald-500/12'
                      : 'border-white/10 bg-white/6 hover:border-white/20 hover:bg-white/8',
                  )}
                >
                  <p className={cn('line-clamp-1 text-sm font-semibold text-white/90')}>{item.title || t('dashboard.home.approvalInbox.untitled')}</p>
                  <p className={cn('mt-1 text-[11px] text-white/65')}>
                    {new Date(item.updated_at).toLocaleString(locale === 'en' ? 'en-GB' : locale === 'es' ? 'es-ES' : 'ca-ES', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </button>
              ))
            ) : (
              <p className={cn('rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100')}>
                {t('dashboard.home.approvalInbox.empty')}
              </p>
            )}
          </div>
        </GlassCard>

        <GlassCard variant="strong" className="p-4 md:p-5">
          {!selectedDraft ? (
            <p className={cn('text-sm', textSub)}>{t('dashboard.litoPage.review.emptyDetail')}</p>
          ) : (
            <div className="space-y-3">
              <div>
                <p className={cn('text-xs uppercase tracking-wide text-white/60')}>{`${selectedDraft.channel} · ${selectedDraft.format}`}</p>
                <h2 className={cn('mt-1 text-lg font-semibold text-white/92')}>{selectedDraft.title || t('dashboard.home.approvalInbox.untitled')}</h2>
              </div>

              <div>
                <p className={cn('text-xs font-medium text-white/70')}>{t('dashboard.litoPage.workbench.tabs.short')}</p>
                <textarea
                  value={copyShort}
                  onChange={(event) => setCopyShort(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                />
              </div>

              <div>
                <p className={cn('text-xs font-medium text-white/70')}>{t('dashboard.litoPage.workbench.tabs.long')}</p>
                <textarea
                  value={copyLong}
                  onChange={(event) => setCopyLong(event.target.value)}
                  rows={7}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                />
              </div>

              <div>
                <p className={cn('text-xs font-medium text-white/70')}>{t('dashboard.litoPage.workbench.tabs.hashtags')}</p>
                <textarea
                  value={hashtagsText}
                  onChange={(event) => setHashtagsText(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                />
              </div>

              <div>
                <p className={cn('text-xs font-medium text-white/70')}>{t('dashboard.litoPage.review.rejectNote')}</p>
                <textarea
                  value={rejectNote}
                  onChange={(event) => setRejectNote(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {selectedDraft.status === 'approved' ? (
                  <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => void copyApproved()}>
                    {t('dashboard.home.recommendations.lito.actions.copy')}
                  </Button>
                ) : null}
                {selectedDraft.status === 'approved' ? (
                  <Button
                    className="h-9 px-3 text-xs"
                    loading={publishing}
                    onClick={() => void publishDraft()}
                  >
                    {t('dashboard.litoPage.approval.publish')}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  className="h-9 px-3 text-xs"
                  loading={acting === 'reject'}
                  disabled={selectedDraft.status !== 'pending'}
                  onClick={() => void rejectDraft()}
                >
                  {t('dashboard.litoPage.approval.reject')}
                </Button>
                <Button
                  className="h-9 px-3 text-xs"
                  loading={acting === 'approve'}
                  disabled={selectedDraft.status !== 'pending'}
                  onClick={() => void approveDraft()}
                >
                  {t('dashboard.litoPage.approval.approve')}
                </Button>
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
