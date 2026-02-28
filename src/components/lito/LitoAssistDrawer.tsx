'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import Tabs from '@/components/ui/Tabs';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/components/i18n/I18nContext';
import { textMain, textSub } from '@/components/ui/glass';

type LitoRole = 'user' | 'assistant' | 'system';

type LitoMessage = {
  id: string;
  role: LitoRole;
  content: string;
  created_at: string;
  meta?: unknown;
};

type RecommendationHowTo = {
  why?: string;
  steps?: string[];
  checklist?: string[];
  assets_needed?: string[];
  time_estimate_min?: number;
  example_caption?: string;
};

type RecommendationLanguage = {
  base_lang?: string;
  suggested_lang?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};

type RecommendationTemplate = {
  format?: string;
  hook?: string;
  idea?: string;
  cta?: string;
  assets_needed?: string[];
  how_to?: RecommendationHowTo;
  language?: RecommendationLanguage;
};

type RecommendationInput = {
  id: string;
  vertical?: string;
  hook?: string;
  idea?: string;
  cta?: string;
  format?: string;
  how_to?: RecommendationHowTo;
  language?: RecommendationLanguage;
  recommendation_template?: RecommendationTemplate;
};

type LitoThreadResponse = {
  ok?: boolean;
  thread?: {
    id: string;
    title: string;
    recommendation_id?: string | null;
  };
  messages?: LitoMessage[];
  business?: {
    name?: string;
    type?: string | null;
    default_language?: string | null;
  } | null;
  language?: {
    base_lang?: string | null;
    suggested_lang?: string | null;
  };
  error?: string;
  message?: string;
};

type LitoMessageResponse = {
  ok?: boolean;
  messages?: LitoMessage[];
  error?: string;
  message?: string;
};

type LitoAssistDrawerProps = {
  open: boolean;
  onClose: () => void;
  bizId: string | null;
  businessName?: string | null;
  threadId: string | null;
  recommendation?: RecommendationInput | null;
};

type LitoTabKey = 'howto' | 'copy' | 'assets';

export default function LitoAssistDrawer({
  open,
  onClose,
  bizId,
  businessName,
  threadId,
  recommendation,
}: LitoAssistDrawerProps) {
  const t = useT();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<LitoTabKey>('howto');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<LitoMessage[]>([]);
  const [input, setInput] = useState('');
  const [baseLang, setBaseLang] = useState<string | null>(null);
  const [suggestedLang, setSuggestedLang] = useState<string | null>(null);
  const [assetsDone, setAssetsDone] = useState<Record<string, boolean>>({});

  const howTo = recommendation?.how_to || recommendation?.recommendation_template?.how_to;
  const assets = useMemo(() => {
    const source = recommendation?.recommendation_template?.assets_needed
      || recommendation?.how_to?.assets_needed
      || [];
    return source.filter((asset): asset is string => typeof asset === 'string' && asset.trim().length > 0);
  }, [recommendation?.how_to?.assets_needed, recommendation?.recommendation_template?.assets_needed]);

  const availableBusinessName = businessName || '';
  const verticalLabel = recommendation?.vertical || 'general';

  const loadThread = useCallback(async () => {
    if (!threadId || !open) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/lito/threads/${threadId}`);
      const payload = (await response.json().catch(() => ({}))) as LitoThreadResponse;
      if (!response.ok || payload.error || !payload.thread) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.loadError'));
      }
      setMessages(payload.messages || []);
      setBaseLang(payload.language?.base_lang || payload.business?.default_language || 'ca');
      setSuggestedLang(payload.language?.suggested_lang || null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.loadError');
      toast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [open, t, threadId, toast]);

  useEffect(() => {
    if (!open) return;
    void loadThread();
  }, [loadThread, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const sendMessage = useCallback(async () => {
    if (!threadId || sending) return;
    const trimmed = input.trim();
    if (!trimmed) return;

    setSending(true);
    try {
      const response = await fetch(`/api/lito/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      });
      const payload = (await response.json().catch(() => ({}))) as LitoMessageResponse;
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.home.recommendations.lito.sendError'));
      }
      if (payload.messages?.length) {
        setMessages((previous) => [...previous, ...payload.messages!]);
      }
      setInput('');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.recommendations.lito.sendError');
      toast(message, 'error');
    } finally {
      setSending(false);
    }
  }, [input, sending, t, threadId, toast]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <button
        aria-label={t('common.close')}
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl border-l border-white/10 bg-zinc-950/85 shadow-[0_20px_80px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
        <div className="flex h-full flex-col">
          <header className="border-b border-white/10 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={cn('text-lg font-semibold', textMain)}>{t('dashboard.home.recommendations.lito.title')}</p>
                <p className={cn('mt-1 text-xs', textSub)}>
                  {availableBusinessName || t('common.appName')}
                  {bizId ? ` · ${verticalLabel}` : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>
                {t('common.close')}
              </Button>
            </div>
          </header>

          <div className="border-b border-white/10 px-5 py-3">
            <Tabs
              value={activeTab}
              onChange={(tab) => setActiveTab(tab as LitoTabKey)}
              items={[
                { key: 'howto', label: t('dashboard.home.recommendations.lito.tabs.howTo') },
                { key: 'copy', label: t('dashboard.home.recommendations.lito.tabs.copy') },
                { key: 'assets', label: t('dashboard.home.recommendations.lito.tabs.assets') },
              ]}
            />
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="space-y-3">
                <div className="h-16 animate-pulse rounded-xl border border-white/10 bg-white/6" />
                <div className="h-16 animate-pulse rounded-xl border border-white/10 bg-white/6" />
              </div>
            ) : (
              <>
                {activeTab === 'howto' && (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/6 p-3">
                    <p className={cn('text-sm font-semibold', textMain)}>
                      {howTo?.why || t('dashboard.home.recommendations.lito.noHowTo')}
                    </p>
                    {howTo?.steps?.length ? (
                      <ol className="list-decimal space-y-1 pl-5 text-sm text-white/80">
                        {howTo.steps.map((step, index) => (
                          <li key={`howto-step-${index}`}>{step}</li>
                        ))}
                      </ol>
                    ) : null}
                    {howTo?.checklist?.length ? (
                      <ul className="space-y-1 text-sm text-white/75">
                        {howTo.checklist.map((entry, index) => (
                          <li key={`howto-check-${index}`} className="flex items-start gap-2">
                            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-300/90" />
                            <span>{entry}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="text-xs text-white/65">
                      {t('dashboard.home.recommendations.lito.languageHint', {
                        base: baseLang || 'ca',
                        suggested: suggestedLang || baseLang || 'ca',
                      })}
                    </p>
                  </div>
                )}

                {activeTab === 'copy' && (
                  <div className="rounded-xl border border-white/10 bg-white/6 p-4 text-sm text-white/82">
                    <p className={cn('font-medium', textMain)}>
                      {t('dashboard.home.recommendations.lito.copyLockedTitle')}
                    </p>
                    <p className="mt-2 text-white/72">{t('dashboard.home.recommendations.lito.copyLockedSubtitle')}</p>
                    <Button variant="secondary" size="sm" className="mt-3">
                      {t('dashboard.home.recommendations.lito.copyLockedCta')}
                    </Button>
                  </div>
                )}

                {activeTab === 'assets' && (
                  <div className="space-y-2 rounded-xl border border-white/10 bg-white/6 p-3">
                    {assets.length > 0 ? (
                      assets.map((asset, index) => {
                        const key = `${index}-${asset}`;
                        const checked = Boolean(assetsDone[key]);
                        return (
                          <label key={key} className="flex items-center gap-2 text-sm text-white/85">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setAssetsDone((previous) => ({ ...previous, [key]: !checked }))}
                              className="h-4 w-4 rounded border-white/25 bg-transparent accent-emerald-400"
                            />
                            <span className={checked ? 'text-white/55 line-through' : ''}>{asset}</span>
                          </label>
                        );
                      })
                    ) : (
                      <p className="text-sm text-white/70">{t('dashboard.home.recommendations.lito.noAssets')}</p>
                    )}
                  </div>
                )}

                <section className="mt-4 space-y-2">
                  <p className={cn('text-xs uppercase tracking-wide text-white/55')}>{t('dashboard.home.recommendations.lito.chatTitle')}</p>
                  <div className="space-y-2">
                    {messages.length === 0 ? (
                      <p className={cn('rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-sm', textSub)}>
                        {t('dashboard.home.recommendations.lito.emptyChat')}
                      </p>
                    ) : (
                      messages.map((message) => {
                        const isUser = message.role === 'user';
                        return (
                          <div
                            key={message.id}
                            className={cn(
                              'max-w-[92%] rounded-xl border px-3 py-2 text-sm whitespace-pre-wrap',
                              isUser
                                ? 'ml-auto border-emerald-300/35 bg-emerald-400/15 text-white'
                                : 'mr-auto border-white/10 bg-white/6 text-white/82',
                            )}
                          >
                            {message.content}
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              </>
            )}
          </div>

          <footer className="border-t border-white/10 px-5 py-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={t('dashboard.home.recommendations.lito.inputPlaceholder')}
                className="h-10 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition-all duration-200 ease-premium placeholder:text-white/45 focus:border-emerald-300/35 focus:ring-2 focus:ring-emerald-400/25"
              />
              <Button type="submit" size="sm" loading={sending} disabled={!threadId || sending || !input.trim()}>
                {t('dashboard.home.recommendations.lito.send')}
              </Button>
            </form>
          </footer>
        </div>
      </aside>
    </div>
  );
}
