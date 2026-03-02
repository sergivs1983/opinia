'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import ActionCard from '@/components/lito-home/ActionCard';
import AdvancedDrawer, { type AdvancedDrawerLink } from '@/components/lito-home/AdvancedDrawer';
import ThemeToggle from '@/components/lito-home/ThemeToggle';
import '@/styles/lito-home.css';

type LitoThreadPayload = {
  thread?: { id?: string };
  error?: string;
  message?: string;
};

type LitoMessagePayload = {
  ok?: boolean;
  error?: string;
  message?: string;
};

type LitoTheme = 'day' | 'night';

const THEME_STORAGE_KEY = 'opinia.lito.home.theme';

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function LitoHome() {
  const t = useT();
  const router = useRouter();
  const { toast } = useToast();
  const { biz } = useWorkspace();

  const [theme, setTheme] = useState<LitoTheme>('night');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === 'day' || savedTheme === 'night') {
        setTheme(savedTheme);
      }
    } catch {
      // Ignore localStorage read errors.
    }
  }, []);

  const handleThemeChange = useCallback((nextTheme: LitoTheme) => {
    setTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore localStorage write errors.
    }
  }, []);

  const withBiz = useCallback((href: string): string => {
    if (!biz?.id) return href;
    const separator = href.includes('?') ? '&' : '?';
    return `${href}${separator}biz_id=${encodeURIComponent(biz.id)}`;
  }, [biz?.id]);

  const advancedLinks = useMemo<AdvancedDrawerLink[]>(() => [
    {
      id: 'chat',
      label: t('dashboard.litoPage.home.advanced.chatLabel'),
      description: t('dashboard.litoPage.home.advanced.chatDescription'),
      href: withBiz('/dashboard/lito/chat'),
    },
    {
      id: 'planner',
      label: t('dashboard.litoPage.home.advanced.plannerLabel'),
      description: t('dashboard.litoPage.home.advanced.plannerDescription'),
      href: withBiz('/dashboard/planner'),
    },
    {
      id: 'review',
      label: t('dashboard.litoPage.home.advanced.reviewLabel'),
      description: t('dashboard.litoPage.home.advanced.reviewDescription'),
      href: withBiz('/dashboard/lito/review'),
    },
    {
      id: 'settings',
      label: t('dashboard.litoPage.home.advanced.settingsLabel'),
      description: t('dashboard.litoPage.home.advanced.settingsDescription'),
      href: '/dashboard/settings?tab=admin',
    },
    {
      id: 'health',
      label: t('dashboard.litoPage.home.advanced.healthLabel'),
      description: t('dashboard.litoPage.home.advanced.healthDescription'),
      href: '/dashboard/health',
    },
    {
      id: 'classic',
      label: t('dashboard.litoPage.home.advanced.classicLabel'),
      description: t('dashboard.litoPage.home.advanced.classicDescription'),
      href: '/dashboard?classic=1',
    },
  ], [t, withBiz]);

  const actionCards = useMemo(() => [
    {
      id: 'publish-today',
      badge: t('dashboard.litoPage.home.actions.card1Badge'),
      title: t('dashboard.litoPage.home.actions.card1Title'),
      description: t('dashboard.litoPage.home.actions.card1Description'),
      cta: t('dashboard.litoPage.home.actions.card1Cta'),
      onClick: () => router.push(withBiz('/dashboard/planner')),
    },
    {
      id: 'copy-ready',
      badge: t('dashboard.litoPage.home.actions.card2Badge'),
      title: t('dashboard.litoPage.home.actions.card2Title'),
      description: t('dashboard.litoPage.home.actions.card2Description'),
      cta: t('dashboard.litoPage.home.actions.card2Cta'),
      onClick: () => {
        setPrompt(t('dashboard.litoPage.home.quickPrompts.prepareWeek'));
      },
    },
    {
      id: 'review-pending',
      badge: t('dashboard.litoPage.home.actions.card3Badge'),
      title: t('dashboard.litoPage.home.actions.card3Title'),
      description: t('dashboard.litoPage.home.actions.card3Description'),
      cta: t('dashboard.litoPage.home.actions.card3Cta'),
      onClick: () => router.push(withBiz('/dashboard/lito/review')),
    },
  ], [router, t, withBiz]);

  const visibleActionCards = actionCards.slice(0, 2);
  const hiddenCardsCount = Math.max(0, actionCards.length - visibleActionCards.length);

  const sendPromptToLito = useCallback(async (value?: string) => {
    const content = (value ?? prompt).trim();
    if (!content || submitting) return;

    if (!biz?.id) {
      toast(t('dashboard.litoPage.home.errors.selectBusiness'), 'warning');
      return;
    }

    setSubmitting(true);
    const requestId = createClientRequestId();

    try {
      const threadResponse = await fetch('/api/lito/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'x-request-id': requestId,
        },
        cache: 'no-store',
        body: JSON.stringify({
          biz_id: biz.id,
          recommendation_id: null,
          title: null,
        }),
      });

      if (threadResponse.status === 401) {
        router.push('/login');
        return;
      }

      const threadPayload = (await threadResponse.json().catch(() => ({}))) as LitoThreadPayload;
      const threadId = threadPayload.thread?.id;
      if (!threadResponse.ok || !threadId) {
        throw new Error(threadPayload.message || t('dashboard.litoPage.home.errors.openThread'));
      }

      const messageResponse = await fetch(`/api/lito/threads/${threadId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'x-request-id': requestId,
        },
        cache: 'no-store',
        body: JSON.stringify({ content }),
      });

      if (messageResponse.status === 401) {
        router.push('/login');
        return;
      }

      const messagePayload = (await messageResponse.json().catch(() => ({}))) as LitoMessagePayload;
      if (!messageResponse.ok || messagePayload.error) {
        throw new Error(messagePayload.message || t('dashboard.litoPage.home.errors.sendMessage'));
      }

      setPrompt('');
      const params = new URLSearchParams({
        biz_id: biz.id,
        thread_id: threadId,
      });
      router.push(`/dashboard/lito/chat?${params.toString()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.home.errors.sendMessage');
      toast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }, [biz?.id, prompt, router, submitting, t, toast]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendPromptToLito();
    }
  }, [sendPromptToLito]);

  const handleQuickPill = useCallback((key: 'prepareWeek' | 'today' | 'signals' | 'planner') => {
    if (key === 'planner') {
      router.push(withBiz('/dashboard/planner'));
      return;
    }

    const nextPrompt = key === 'prepareWeek'
      ? t('dashboard.litoPage.home.quickPrompts.prepareWeek')
      : key === 'today'
      ? t('dashboard.litoPage.home.quickPrompts.today')
      : t('dashboard.litoPage.home.quickPrompts.signals');

    setPrompt(nextPrompt);
    void sendPromptToLito(nextPrompt);
  }, [router, sendPromptToLito, t, withBiz]);

  const isSubmitDisabled = submitting || prompt.trim().length === 0;

  return (
    <section className="lito-home" data-theme={theme}>
      <div className="lito-home-ambient-light" aria-hidden="true" />
      <div className="lito-home-noise" aria-hidden="true" />

      <ThemeToggle
        theme={theme}
        dayLabel={t('dashboard.litoPage.home.theme.day')}
        nightLabel={t('dashboard.litoPage.home.theme.night')}
        onChange={handleThemeChange}
      />

      <div className="lito-home-shell">
        <header className="lito-home-header">
          <p className="lito-home-eyebrow">LITO Copilot</p>
          <h1>{t('dashboard.litoPage.home.title')}</h1>
          <p>{t('dashboard.litoPage.home.subtitle')}</p>
        </header>

        <div className="lito-home-input-card">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('dashboard.litoPage.home.inputPlaceholder')}
            className="lito-home-input"
            rows={3}
          />
          <button
            type="button"
            className="lito-home-send"
            onClick={() => void sendPromptToLito()}
            disabled={isSubmitDisabled}
          >
            {submitting ? t('dashboard.litoPage.home.sending') : t('dashboard.litoPage.home.send')}
          </button>
        </div>

        <div className="lito-home-quick-pills">
          <button type="button" className="lito-home-pill" onClick={() => handleQuickPill('prepareWeek')}>
            {t('dashboard.litoPage.home.quickPills.prepareWeek')}
          </button>
          <button type="button" className="lito-home-pill" onClick={() => handleQuickPill('today')}>
            {t('dashboard.litoPage.home.quickPills.today')}
          </button>
          <button type="button" className="lito-home-pill" onClick={() => handleQuickPill('signals')}>
            {t('dashboard.litoPage.home.quickPills.signals')}
          </button>
          <button type="button" className="lito-home-pill" onClick={() => handleQuickPill('planner')}>
            {t('dashboard.litoPage.home.quickPills.planner')}
          </button>
        </div>

        {visibleActionCards.length > 0 ? (
          <section className="lito-home-actions">
            <div className="lito-home-actions-header">
              <h2>{t('dashboard.litoPage.home.actions.title')}</h2>
              {hiddenCardsCount > 0 ? (
                <button type="button" className="lito-home-view-all" onClick={() => setDrawerOpen(true)}>
                  {t('dashboard.litoPage.home.actions.viewAll', { count: hiddenCardsCount })}
                </button>
              ) : null}
            </div>
            <div className="lito-home-actions-grid">
              {visibleActionCards.map((card) => (
                <ActionCard
                  key={card.id}
                  badge={card.badge}
                  title={card.title}
                  description={card.description}
                  ctaLabel={card.cta}
                  onCta={card.onClick}
                />
              ))}
            </div>
          </section>
        ) : null}

        <button type="button" className="lito-home-advanced-trigger" onClick={() => setDrawerOpen(true)}>
          {t('dashboard.litoPage.home.advanced.open')}
        </button>
      </div>

      <AdvancedDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={t('dashboard.litoPage.home.advanced.title')}
        subtitle={t('dashboard.litoPage.home.advanced.subtitle')}
        links={advancedLinks}
      />
    </section>
  );
}
