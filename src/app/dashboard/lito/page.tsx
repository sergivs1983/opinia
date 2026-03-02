'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useMemo, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import CommandBar from '@/components/lito/home/CommandBar';
import ActionCardStack from '@/components/lito/home/ActionCardStack';
import CardQueueDrawer from '@/components/lito/home/CardQueueDrawer';
import LitoHeader from '@/components/lito/home/LitoHeader';
import { useActionCards } from '@/components/lito/home/useActionCards';
import { useLocale } from '@/components/i18n/I18nContext';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { ActionCard, ActionCardCta } from '@/types/lito-cards';
import '@/styles/lito-action-stream.css';

type LocaleKey = 'ca' | 'es' | 'en';

type LocalCopy = {
  greetingMorning: string;
  greetingAfternoon: string;
  greetingEvening: string;
  priorityPrefix: string;
  priorityFallback: string;
  weekTitle: string;
  emptyTitle: string;
  emptySubtitle: string;
  preparingDay: string;
  updating: string;
  viewAll: string;
  advanced: string;
  business: string;
  queueTitle: string;
  close: string;
  queueEmpty: string;
  commandPlaceholder: string;
  send: string;
  mic: string;
  assistantPanelTitle: string;
  assistantThinking: string;
  assistantFallbackError: string;
  copied: string;
  ready: string;
  actionFailed: string;
  selectBusiness: string;
  retry: string;
};

type SocialDraftListPayload = {
  items?: Array<{
    id?: string;
    version?: number;
  }>;
};

type CommandPanelState = {
  loading: boolean;
  text: string;
  error: string | null;
};

const LAST_BIZ_STORAGE_KEY = 'opinia.lito.last_biz_id';

const COPY: Record<LocaleKey, LocalCopy> = {
  ca: {
    greetingMorning: 'Bon dia',
    greetingAfternoon: 'Bona tarda',
    greetingEvening: 'Bona nit',
    priorityPrefix: 'Prioritat d’ara:',
    priorityFallback: 'No hi ha prioritats pendents.',
    weekTitle: 'Aquesta setmana',
    emptyTitle: 'Tot al dia',
    emptySubtitle: 'No hi ha accions prioritàries ara mateix.',
    preparingDay: 'Preparant el teu dia…',
    updating: 'Actualitzant…',
    viewAll: 'Veure tot',
    advanced: 'Opcions avançades',
    business: 'Negoci actiu',
    queueTitle: 'Cua d’accions',
    close: 'Tancar',
    queueEmpty: 'No hi ha cards disponibles.',
    commandPlaceholder: 'Digues-me…',
    send: 'Enviar',
    mic: 'Micròfon',
    assistantPanelTitle: 'Resposta de LITO',
    assistantThinking: 'Pensant…',
    assistantFallbackError: 'No he pogut respondre ara mateix.',
    copied: 'Copiat',
    ready: 'A punt',
    actionFailed: 'No s’ha pogut completar l’acció.',
    selectBusiness: 'Selecciona un negoci per continuar.',
    retry: 'Reintentar',
  },
  es: {
    greetingMorning: 'Buenos días',
    greetingAfternoon: 'Buenas tardes',
    greetingEvening: 'Buenas noches',
    priorityPrefix: 'Prioridad ahora:',
    priorityFallback: 'No hay prioridades pendientes.',
    weekTitle: 'Esta semana',
    emptyTitle: 'Todo al día',
    emptySubtitle: 'No hay acciones prioritarias ahora mismo.',
    preparingDay: 'Preparando tu día…',
    updating: 'Actualizando…',
    viewAll: 'Ver todo',
    advanced: 'Opciones avanzadas',
    business: 'Negocio activo',
    queueTitle: 'Cola de acciones',
    close: 'Cerrar',
    queueEmpty: 'No hay tarjetas disponibles.',
    commandPlaceholder: 'Dime…',
    send: 'Enviar',
    mic: 'Micrófono',
    assistantPanelTitle: 'Respuesta de LITO',
    assistantThinking: 'Pensando…',
    assistantFallbackError: 'No pude responder ahora mismo.',
    copied: 'Copiado',
    ready: 'Listo',
    actionFailed: 'No se pudo completar la acción.',
    selectBusiness: 'Selecciona un negocio para continuar.',
    retry: 'Reintentar',
  },
  en: {
    greetingMorning: 'Good morning',
    greetingAfternoon: 'Good afternoon',
    greetingEvening: 'Good evening',
    priorityPrefix: 'Top priority:',
    priorityFallback: 'No pending priorities right now.',
    weekTitle: 'This week',
    emptyTitle: 'All caught up',
    emptySubtitle: 'No priority actions right now.',
    preparingDay: 'Preparing your day…',
    updating: 'Updating…',
    viewAll: 'View all',
    advanced: 'Advanced options',
    business: 'Active business',
    queueTitle: 'Action queue',
    close: 'Close',
    queueEmpty: 'No cards available.',
    commandPlaceholder: 'Tell me…',
    send: 'Send',
    mic: 'Microphone',
    assistantPanelTitle: 'LITO response',
    assistantThinking: 'Thinking…',
    assistantFallbackError: 'I could not respond right now.',
    copied: 'Copied',
    ready: 'Ready',
    actionFailed: 'Could not complete action.',
    selectBusiness: 'Select a business to continue.',
    retry: 'Retry',
  },
};

function resolveLocale(locale: string): LocaleKey {
  if (locale.startsWith('ca')) return 'ca';
  if (locale.startsWith('es')) return 'es';
  return 'en';
}

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readLastBizId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(LAST_BIZ_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function writeLastBizId(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_BIZ_STORAGE_KEY, value);
  } catch {
    // Ignore localStorage write errors.
  }
}

function actionBusyKey(cardId: string, action: string): string {
  return `${cardId}:${action}`;
}

function getPayloadValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function findRef(card: ActionCard, kind: string): string | null {
  const hit = card.refs.find((entry) => entry.kind === kind);
  return hit?.id || null;
}

export default function DashboardLitoPage() {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { biz, businesses, switchBiz, loading: workspaceLoading } = useWorkspace();

  const [queueOpen, setQueueOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [commandPanel, setCommandPanel] = useState<CommandPanelState | null>(null);
  const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});

  const lang = useMemo(() => resolveLocale(locale), [locale]);
  const copy = COPY[lang];

  const activeBizId = biz?.id || null;
  const { cards, mode, queueCount, source, error, refresh } = useActionCards({ bizId: activeBizId });

  useEffect(() => {
    if (workspaceLoading) return;
    if (!businesses.length) return;

    const queryBizId = (searchParams?.get('biz_id') || '').trim();
    const storedBizId = readLastBizId();
    const allowed = new Set(businesses.map((entry) => entry.id));

    let targetBizId: string | null = null;
    if (queryBizId && allowed.has(queryBizId)) {
      targetBizId = queryBizId;
    } else if (storedBizId && allowed.has(storedBizId)) {
      targetBizId = storedBizId;
    } else {
      targetBizId = businesses[0]?.id || null;
    }

    if (!targetBizId) return;

    if (biz?.id !== targetBizId) {
      switchBiz(targetBizId);
    }

    writeLastBizId(targetBizId);

    if (queryBizId !== targetBizId) {
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.set('biz_id', targetBizId);
      router.replace(`/dashboard/lito?${params.toString()}`);
    }
  }, [workspaceLoading, businesses, searchParams, biz?.id, switchBiz, router]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    const tone = hour < 12 ? copy.greetingMorning : hour < 20 ? copy.greetingAfternoon : copy.greetingEvening;
    const name = biz?.name ? `, ${biz.name}` : '';
    return `${tone}${name}`;
  }, [biz?.name, copy.greetingAfternoon, copy.greetingEvening, copy.greetingMorning]);

  const priorityLine = useMemo(() => {
    if (!cards.length) return `${copy.priorityPrefix} ${copy.priorityFallback}`;
    return `${copy.priorityPrefix} ${cards[0].title}`;
  }, [cards, copy.priorityFallback, copy.priorityPrefix]);

  const withActionBusy = useCallback(async (card: ActionCard, cta: ActionCardCta, task: () => Promise<void>) => {
    const key = actionBusyKey(card.id, cta.action);
    setActionBusy((prev) => ({ ...prev, [key]: true }));
    try {
      await task();
    } finally {
      setActionBusy((prev) => ({ ...prev, [key]: false }));
    }
  }, []);

  const postJson = useCallback(async (url: string, body?: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-store',
        'x-request-id': createClientRequestId(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({} as Record<string, unknown>));
      const message = (payload.message as string) || (payload.error as string) || 'request_failed';
      throw new Error(message);
    }

    return response;
  }, []);

  const approveSocialDraft = useCallback(async (draftId: string): Promise<boolean> => {
    if (!activeBizId) return false;

    const listResponse = await fetch(`/api/social/drafts?biz_id=${encodeURIComponent(activeBizId)}&status=pending&limit=50`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-store',
        'x-request-id': createClientRequestId(),
      },
    });

    if (!listResponse.ok) return false;

    const listPayload = (await listResponse.json().catch(() => ({}))) as SocialDraftListPayload;
    const item = (listPayload.items || []).find((entry) => entry.id === draftId);
    const version = typeof item?.version === 'number' ? item.version : null;
    if (!version) return false;

    await postJson(`/api/social/drafts/${draftId}/approve`, { version });
    return true;
  }, [activeBizId, postJson]);

  const handleCardAction = useCallback(async (card: ActionCard, cta: ActionCardCta) => {
    await withActionBusy(card, cta, async () => {
      const payload = cta.payload || {};
      const scheduleId = getPayloadValue(payload, 'schedule_id') || findRef(card, 'schedule_id');
      const draftId = getPayloadValue(payload, 'draft_id') || findRef(card, 'draft_id');
      const platform = getPayloadValue(payload, 'platform');

      try {
        if (cta.action === 'copy_open') {
          const text = getPayloadValue(payload, 'copy_text') || `${card.title}\n${card.subtitle}`;
          if (text && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            toast(copy.copied, 'success');
          } else {
            toast(copy.ready, 'info');
          }

          if (platform === 'instagram') {
            window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
          } else if (platform === 'tiktok') {
            window.open('https://www.tiktok.com/', '_blank', 'noopener,noreferrer');
          }

          return;
        }

        if (cta.action === 'mark_done' && scheduleId) {
          await postJson(`/api/social/schedules/${scheduleId}/publish`);
          toast(copy.ready, 'success');
          await refresh();
          return;
        }

        if (cta.action === 'snooze' && scheduleId) {
          await postJson(`/api/social/schedules/${scheduleId}/snooze`, { mode: 'tomorrow_same_time' });
          toast(copy.ready, 'success');
          await refresh();
          return;
        }

        if (cta.action === 'approve' && draftId) {
          const approved = await approveSocialDraft(draftId);
          if (approved) {
            toast(copy.ready, 'success');
            await refresh();
            return;
          }
        }

        if (cta.action === 'open_weekly_wizard') {
          setCommand(lang === 'ca' ? 'Prepara la meva setmana amb 3 posts.' : lang === 'es' ? 'Prepara mi semana con 3 posts.' : 'Prepare my week with 3 posts.');
          toast(copy.ready, 'info');
          return;
        }

        if (cta.action === 'open_pending') {
          router.push(`/dashboard/planner${activeBizId ? `?biz_id=${encodeURIComponent(activeBizId)}` : ''}`);
          return;
        }

        if (cta.action === 'view_recommendation') {
          router.push(`/dashboard/lito/review${activeBizId ? `?biz_id=${encodeURIComponent(activeBizId)}` : ''}`);
          return;
        }

        if (cta.action === 'ack') {
          toast(copy.ready, 'info');
          return;
        }

        if (cta.action === 'regenerate' || cta.action === 'edit' || cta.action === 'view_only') {
          console.info('lito_action_cards_placeholder', {
            card_id: card.id,
            action: cta.action,
            payload,
          });
          toast(copy.ready, 'info');
          return;
        }

        toast(copy.ready, 'info');
      } catch (actionError) {
        console.error('lito_action_cards_action_error', {
          card_id: card.id,
          action: cta.action,
          error: actionError instanceof Error ? actionError.message : String(actionError),
        });
        toast(copy.actionFailed, 'error');
      }
    });
  }, [withActionBusy, toast, copy, postJson, refresh, approveSocialDraft, lang, router, activeBizId]);

  const handleCommandPanelState = useCallback((next: CommandPanelState) => {
    setCommandPanel(next);
  }, []);

  const openAdvanced = useCallback(() => {
    router.push('/dashboard?classic=1');
  }, [router]);

  const handleBizChange = useCallback((nextBizId: string) => {
    switchBiz(nextBizId);
    writeLastBizId(nextBizId);
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('biz_id', nextBizId);
    router.replace(`/dashboard/lito?${params.toString()}`);
  }, [switchBiz, searchParams, router]);

  const handleMic = useCallback(() => {
    toast(copy.ready, 'info');
  }, [toast, copy.ready]);

  return (
    <section className="lito-action-stream">
      <div className="lito-action-shell">
        <LitoHeader
          greeting={greeting}
          priorityLine={priorityLine}
          advancedLabel={copy.advanced}
          businessLabel={copy.business}
          businesses={businesses.map((entry) => ({ id: entry.id, name: entry.name }))}
          activeBizId={activeBizId}
          onBizChange={handleBizChange}
          onOpenAdvanced={openAdvanced}
        />

        {commandPanel ? (
          <article className={`lito-assistant-panel${commandPanel.error ? ' is-error' : ''}`} role="status" aria-live="polite">
            <div className="lito-assistant-panel-head">
              <h3>{copy.assistantPanelTitle}</h3>
              {commandPanel.loading ? (
                <span className="lito-assistant-panel-loading">
                  <span className="lito-source-spinner" aria-hidden="true" />
                  {copy.assistantThinking}
                </span>
              ) : null}
            </div>
            <p>{commandPanel.error || commandPanel.text || copy.assistantThinking}</p>
          </article>
        ) : null}

        <ActionCardStack
          cards={cards}
          mode={mode}
          source={source}
          queueCount={queueCount}
          title={copy.weekTitle}
          emptyTitle={copy.emptyTitle}
          emptySubtitle={copy.emptySubtitle}
          preparingText={copy.preparingDay}
          updatingText={copy.updating}
          viewAllLabel={copy.viewAll}
          onOpenQueue={() => setQueueOpen(true)}
          onAction={handleCardAction}
          busyMap={actionBusy}
        />

        {error ? (
          <article className="lito-empty-card">
            <h3>{copy.queueTitle}</h3>
            <p>{error}</p>
            <button type="button" className="lito-view-all" onClick={() => void refresh()}>
              {copy.retry}
            </button>
          </article>
        ) : null}
      </div>

      <CardQueueDrawer
        open={queueOpen}
        title={copy.queueTitle}
        closeLabel={copy.close}
        emptyLabel={copy.queueEmpty}
        cards={cards}
        queueCount={queueCount}
        busyMap={actionBusy}
        onClose={() => setQueueOpen(false)}
        onAction={handleCardAction}
      />

      <CommandBar
        bizId={activeBizId}
        placeholder={copy.commandPlaceholder}
        sendLabel={copy.send}
        micLabel={copy.mic}
        value={command}
        mode="chat"
        missingBizLabel={copy.selectBusiness}
        fallbackErrorLabel={copy.assistantFallbackError}
        onChange={setCommand}
        onMic={handleMic}
        onPanelStateChange={handleCommandPanelState}
      />
    </section>
  );
}
