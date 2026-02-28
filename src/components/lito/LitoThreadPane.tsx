'use client';

import Button from '@/components/ui/Button';
import { textMain, textSub } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import type { LitoRecommendationItem, LitoThreadItem, LitoThreadMessage } from '@/components/lito/types';

type LitoThreadPaneProps = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  threads: LitoThreadItem[];
  threadsLoading: boolean;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onOpenGeneralThread: () => void;
  onOpenThreadForFormat: (format: 'post' | 'story' | 'reel') => void;
  selectedFormat: 'post' | 'story' | 'reel';
  messages: LitoThreadMessage[];
  messagesLoading: boolean;
  draftMessage: string;
  sending: boolean;
  onDraftMessageChange: (value: string) => void;
  onSendMessage: () => void;
  activeRecommendation: LitoRecommendationItem | null;
};

function formatThreadDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleString('ca-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sanitizedMessages(messages: LitoThreadMessage[]): LitoThreadMessage[] {
  return messages.filter((item) => {
    if (item.role !== 'system') return true;
    return !item.content.toUpperCase().includes('CONTEXT');
  });
}

export default function LitoThreadPane({
  t,
  threads,
  threadsLoading,
  selectedThreadId,
  onSelectThread,
  onOpenGeneralThread,
  onOpenThreadForFormat,
  selectedFormat,
  messages,
  messagesLoading,
  draftMessage,
  sending,
  onDraftMessageChange,
  onSendMessage,
  activeRecommendation,
}: LitoThreadPaneProps) {
  const visibleMessages = sanitizedMessages(messages);

  return (
    <section className="flex min-h-[70vh] flex-col rounded-2xl border border-white/10 bg-zinc-900/45 backdrop-blur-md">
      <header className="border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={cn('text-sm font-semibold tracking-wide', textMain)}>
            {t('dashboard.litoPage.thread.title')}
          </h2>
          <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={onOpenGeneralThread}>
            {t('dashboard.litoPage.thread.newThread')}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(['post', 'story', 'reel'] as const).map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => onOpenThreadForFormat(format)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-premium',
                selectedFormat === format
                  ? 'border-emerald-300/45 bg-emerald-500/12 text-emerald-200'
                  : 'border-white/10 bg-white/4 text-white/70 hover:border-white/20 hover:text-white',
              )}
            >
              {format === 'post' ? '📸 Post' : format === 'story' ? '⏱️ Story' : '🎬 Reel'}
            </button>
          ))}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 border-b border-white/10 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="max-h-[34vh] overflow-y-auto border-b border-white/10 bg-black/20 p-3 xl:max-h-none xl:border-b-0 xl:border-r xl:border-white/10">
          {threadsLoading ? (
            <div className="space-y-2">
              <div className="h-12 animate-pulse rounded-xl border border-white/8 bg-white/6" />
              <div className="h-12 animate-pulse rounded-xl border border-white/8 bg-white/6" />
            </div>
          ) : threads.length > 0 ? (
            <div className="space-y-2">
              {threads.map((thread) => {
                const selected = selectedThreadId === thread.id;
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => onSelectThread(thread.id)}
                    className={cn(
                      'w-full rounded-xl border px-3 py-2 text-left transition-all duration-200 ease-premium',
                      selected
                        ? 'border-emerald-300/45 bg-emerald-500/12'
                        : 'border-white/8 bg-white/4 hover:border-white/15 hover:bg-white/8',
                    )}
                  >
                    <p className="truncate text-xs font-medium text-white/88">{thread.title}</p>
                    <p className={cn('mt-1 text-[11px]', textSub)}>{formatThreadDate(thread.updated_at)}</p>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className={cn('rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs', textSub)}>
              {t('dashboard.litoPage.thread.emptyThreads')}
            </p>
          )}
        </aside>

        <div className="flex min-h-0 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {activeRecommendation ? (
              <div className="mb-3 rounded-xl border border-white/10 bg-white/6 p-3">
                <p className="text-[11px] uppercase tracking-wide text-white/55">
                  {t('dashboard.litoPage.thread.assignmentTitle')}
                </p>
                <p className={cn('mt-1 text-sm font-semibold', textMain)}>{activeRecommendation.hook}</p>
                <p className={cn('mt-1 text-sm text-white/82')}>{activeRecommendation.idea}</p>
                <p className="mt-1 text-xs text-emerald-300/85">{activeRecommendation.cta}</p>
              </div>
            ) : null}

            {messagesLoading ? (
              <div className="space-y-2">
                <div className="h-14 animate-pulse rounded-xl border border-white/8 bg-white/6" />
                <div className="h-14 animate-pulse rounded-xl border border-white/8 bg-white/6" />
              </div>
            ) : visibleMessages.length > 0 ? (
              <div className="space-y-2.5">
                {visibleMessages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      'max-w-[88%] rounded-2xl border px-3 py-2 text-sm',
                      message.role === 'user'
                        ? 'ml-auto border-emerald-300/30 bg-emerald-500/12 text-emerald-100'
                        : 'border-white/10 bg-white/6 text-white/88',
                    )}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className={cn('rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm', textSub)}>
                {t('dashboard.home.recommendations.lito.emptyChat')}
              </p>
            )}
          </div>

          <div className="border-t border-white/10 px-4 py-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draftMessage}
                onChange={(event) => onDraftMessageChange(event.target.value)}
                rows={2}
                placeholder={t('dashboard.home.recommendations.lito.inputPlaceholder')}
                className="min-h-[72px] w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white outline-none transition-all duration-200 ease-premium focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/20"
              />
              <Button
                size="sm"
                className="h-10 px-3 text-xs"
                loading={sending}
                disabled={sending || draftMessage.trim().length < 2}
                onClick={onSendMessage}
              >
                {t('dashboard.home.recommendations.lito.send')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
