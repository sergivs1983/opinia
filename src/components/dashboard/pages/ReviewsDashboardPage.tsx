'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ShellPageHeader } from '@/components/ui/AppShell';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type ReviewStatus = 'pending' | 'replied';
type DraftStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'executed';
type ViewerRole = 'owner' | 'manager' | 'staff' | null;

type ReviewsListItem = {
  id: string;
  provider: string;
  provider_review_id: string | null;
  rating: number;
  text_snippet: string;
  author: string | null;
  reply_status: ReviewStatus;
  created_at: string;
};

type ReviewsListPayload = {
  ok?: boolean;
  items?: ReviewsListItem[];
  next_cursor?: string | null;
  error?: string;
  message?: string;
};

type ReviewsSyncPayload = {
  ok?: boolean;
  sync?: {
    synced?: number;
    upserted?: number;
    skipped?: string;
  };
  error?: string;
  message?: string;
};

type ConnectorHealthStatus = 'ok' | 'error' | 'needs_reauth' | null;

type IntegrationHealthPayload = {
  ok?: boolean;
  provider?: string;
  health?: {
    last_sync_at?: string | null;
    last_sync_status?: ConnectorHealthStatus;
    last_error_code?: string | null;
    last_error_detail?: string | null;
    consecutive_failures?: number;
    needs_reauth?: boolean;
  };
  error?: string;
  message?: string;
};

type RawActionDraft = {
  id: string;
  kind?: string;
  status: DraftStatus;
  payload?: unknown;
  created_by?: string | null;
  reviewed_by?: string | null;
  updated_at: string;
};

type ActionDraftsPayload = {
  ok?: boolean;
  items?: RawActionDraft[];
  viewer_role?: ViewerRole;
  error?: string;
  message?: string;
};

type ReviewDraft = {
  id: string;
  status: DraftStatus;
  review_id: string | null;
  suggested_reply: string;
  updated_at: string;
  created_by: string | null;
  reviewed_by: string | null;
  raw_payload: Record<string, unknown>;
};

type DraftMutationPayload = {
  ok?: boolean;
  draft?: { id?: string };
  error?: string;
  message?: string;
};

const PAGE_SIZE = 20;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ca-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ca-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function healthStatusLabel(status: ConnectorHealthStatus): string {
  if (status === 'ok') return 'OK';
  if (status === 'needs_reauth') return 'Needs reauth';
  if (status === 'error') return 'Error';
  return 'Sense dades';
}

function renderStars(rating: number): string {
  const safeRating = Math.max(0, Math.min(5, Math.floor(rating)));
  return `${'★'.repeat(safeRating)}${'☆'.repeat(5 - safeRating)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeReviewDraft(raw: RawActionDraft): ReviewDraft | null {
  if (raw.kind !== 'gbp_update') return null;

  const payload = asRecord(raw.payload) || {};
  const reviewId = typeof payload.review_id === 'string' ? payload.review_id : null;
  const suggestedReply = typeof payload.suggested_reply === 'string' ? payload.suggested_reply : '';

  return {
    id: raw.id,
    status: raw.status,
    review_id: reviewId,
    suggested_reply: suggestedReply,
    updated_at: raw.updated_at,
    created_by: typeof raw.created_by === 'string' ? raw.created_by : null,
    reviewed_by: typeof raw.reviewed_by === 'string' ? raw.reviewed_by : null,
    raw_payload: payload,
  };
}

function draftStatusLabel(status: DraftStatus): string {
  if (status === 'draft') return 'draft';
  if (status === 'pending_review') return 'pending review';
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'executed';
}

function isManagerRole(role: ViewerRole): boolean {
  return role === 'owner' || role === 'manager';
}

export default function ReviewsDashboardPage() {
  const { biz } = useWorkspace();
  const { toast } = useToast();

  const [status, setStatus] = useState<ReviewStatus>('pending');
  const [items, setItems] = useState<ReviewsListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState<ConnectorHealthStatus>(null);
  const [healthLastSyncAt, setHealthLastSyncAt] = useState<string | null>(null);
  const [healthNeedsReauth, setHealthNeedsReauth] = useState(false);
  const [healthErrorCode, setHealthErrorCode] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<ReviewDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [viewerRole, setViewerRole] = useState<ViewerRole>(null);
  const [editorReviewId, setEditorReviewId] = useState<string | null>(null);
  const [editorText, setEditorText] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [submittingDraftId, setSubmittingDraftId] = useState<string | null>(null);
  const [decisionDraftId, setDecisionDraftId] = useState<string | null>(null);

  const bizId = biz?.id || null;

  const fetchReviews = useCallback(async (mode: 'reset' | 'append') => {
    if (!bizId) {
      setItems([]);
      setNextCursor(null);
      setError(null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    if (mode === 'reset') {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }

    const cursor = mode === 'append' ? nextCursor : null;
    const url = new URL('/api/reviews', window.location.origin);
    url.searchParams.set('biz_id', bizId);
    url.searchParams.set('status', status);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'x-biz-id': bizId,
        },
        cache: 'no-store',
      });

      const payload = (await response.json().catch(() => ({}))) as ReviewsListPayload;
      if (!response.ok || !Array.isArray(payload.items)) {
        const message = payload.message || 'No s’han pogut carregar les ressenyes';
        setError(message);
        if (mode === 'reset') {
          setItems([]);
          setNextCursor(null);
        }
        return;
      }

      if (mode === 'reset') {
        setItems(payload.items);
      } else {
        setItems((prev) => [...prev, ...payload.items!]);
      }
      setNextCursor(payload.next_cursor || null);
      setError(null);
    } catch {
      const message = 'No s’han pogut carregar les ressenyes';
      setError(message);
      if (mode === 'reset') {
        setItems([]);
        setNextCursor(null);
      }
    } finally {
      if (mode === 'reset') setLoading(false);
      if (mode === 'append') setLoadingMore(false);
    }
  }, [bizId, nextCursor, status]);

  const fetchDrafts = useCallback(async () => {
    if (!bizId) {
      setDrafts([]);
      setViewerRole(null);
      setDraftsLoading(false);
      return;
    }

    setDraftsLoading(true);
    try {
      const url = new URL('/api/lito/action-drafts', window.location.origin);
      url.searchParams.set('biz_id', bizId);
      url.searchParams.set('limit', '100');

      const response = await fetch(url.toString(), {
        headers: { 'x-biz-id': bizId },
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => ({}))) as ActionDraftsPayload;
      if (!response.ok || !Array.isArray(payload.items)) {
        if (response.status === 404) {
          setDrafts([]);
          setViewerRole(null);
          return;
        }
        toast(payload.message || 'No s’han pogut carregar els drafts', 'error');
        return;
      }

      const normalized = payload.items
        .map(normalizeReviewDraft)
        .filter((item): item is ReviewDraft => Boolean(item))
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      setDrafts(normalized);
      setViewerRole(payload.viewer_role || null);
    } catch {
      toast('No s’han pogut carregar els drafts', 'error');
    } finally {
      setDraftsLoading(false);
    }
  }, [bizId, toast]);

  const fetchHealth = useCallback(async () => {
    if (!bizId) {
      setHealthStatus(null);
      setHealthLastSyncAt(null);
      setHealthNeedsReauth(false);
      setHealthErrorCode(null);
      setHealthLoading(false);
      return;
    }

    setHealthLoading(true);
    try {
      const url = new URL('/api/integrations/health', window.location.origin);
      url.searchParams.set('biz_id', bizId);

      const response = await fetch(url.toString(), {
        headers: { 'x-biz-id': bizId },
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => ({}))) as IntegrationHealthPayload;
      if (!response.ok || !payload.ok || !payload.health) {
        if (response.status === 404) {
          setHealthStatus(null);
          setHealthLastSyncAt(null);
          setHealthNeedsReauth(false);
          setHealthErrorCode(null);
          return;
        }
        return;
      }

      setHealthStatus(payload.health.last_sync_status || null);
      setHealthLastSyncAt(payload.health.last_sync_at || null);
      setHealthNeedsReauth(Boolean(payload.health.needs_reauth));
      setHealthErrorCode(payload.health.last_error_code || null);
    } finally {
      setHealthLoading(false);
    }
  }, [bizId]);

  useEffect(() => {
    void fetchReviews('reset');
  }, [fetchReviews]);

  useEffect(() => {
    void fetchDrafts();
  }, [fetchDrafts]);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  const handleSyncNow = useCallback(async () => {
    if (!bizId || syncing) return;
    setSyncing(true);
    try {
      const response = await fetch(`/api/reviews/sync?biz_id=${encodeURIComponent(bizId)}`, {
        method: 'POST',
        headers: {
          'x-biz-id': bizId,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as ReviewsSyncPayload;
      if (!response.ok || !payload.ok) {
        toast(payload.message || 'No s’ha pogut sincronitzar', 'error');
        return;
      }

      const synced = payload.sync?.synced ?? 0;
      const upserted = payload.sync?.upserted ?? 0;
      toast(`Sync completat (${synced} llegides, ${upserted} upsert)`, 'success');
      await fetchReviews('reset');
      await fetchDrafts();
      await fetchHealth();
    } catch {
      toast('No s’ha pogut sincronitzar', 'error');
    } finally {
      setSyncing(false);
    }
  }, [bizId, syncing, toast, fetchReviews, fetchDrafts, fetchHealth]);

  const titleStats = useMemo(() => {
    const pending = items.filter((item) => item.reply_status === 'pending').length;
    const replied = items.filter((item) => item.reply_status === 'replied').length;
    return { pending, replied };
  }, [items]);

  const reviewMap = useMemo(() => {
    const map = new Map<string, ReviewsListItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const draftsByReviewId = useMemo(() => {
    const map = new Map<string, ReviewDraft>();
    for (const draft of drafts) {
      if (!draft.review_id) continue;
      if (!map.has(draft.review_id)) {
        map.set(draft.review_id, draft);
      }
    }
    return map;
  }, [drafts]);

  const pendingApprovalDrafts = useMemo(
    () => drafts.filter((draft) => draft.status === 'pending_review'),
    [drafts],
  );

  const editorDraft = useMemo(() => {
    if (!editorReviewId) return null;
    return draftsByReviewId.get(editorReviewId) || null;
  }, [draftsByReviewId, editorReviewId]);

  const openDraftEditor = useCallback((reviewId: string) => {
    const current = draftsByReviewId.get(reviewId);
    setEditorReviewId(reviewId);
    setEditorText(current?.suggested_reply || '');
  }, [draftsByReviewId]);

  const closeDraftEditor = useCallback(() => {
    setEditorReviewId(null);
    setEditorText('');
  }, []);

  const upsertDraft = useCallback(async (): Promise<string | null> => {
    if (!bizId || !editorReviewId) return null;

    const nextText = editorText.trim();
    if (!nextText) {
      toast('Escriu una resposta abans de desar', 'error');
      return null;
    }

    setSavingDraft(true);
    try {
      if (editorDraft) {
        const response = await fetch(`/api/lito/action-drafts/${encodeURIComponent(editorDraft.id)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-biz-id': bizId,
          },
          body: JSON.stringify({
            payload: {
              ...editorDraft.raw_payload,
              review_id: editorDraft.review_id || editorReviewId,
              suggested_reply: nextText,
            },
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as DraftMutationPayload;
        if (!response.ok || !payload.draft?.id) {
          toast(payload.message || 'No s’ha pogut desar el draft', 'error');
          return null;
        }

        toast('Draft desat', 'success');
        await fetchDrafts();
        return payload.draft.id;
      }

      const response = await fetch('/api/lito/reviews/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': bizId,
        },
        body: JSON.stringify({
          biz_id: bizId,
          review_id: editorReviewId,
          response_text: nextText,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as DraftMutationPayload;
      if (!response.ok || !payload.draft?.id) {
        toast(payload.message || 'No s’ha pogut crear el draft', 'error');
        return null;
      }

      toast('Draft creat', 'success');
      await fetchDrafts();
      return payload.draft.id;
    } catch {
      toast('No s’ha pogut desar el draft', 'error');
      return null;
    } finally {
      setSavingDraft(false);
    }
  }, [bizId, editorReviewId, editorText, editorDraft, fetchDrafts, toast]);

  const submitDraft = useCallback(async (draftId: string): Promise<boolean> => {
    if (!bizId) return false;

    setSubmittingDraftId(draftId);
    try {
      const response = await fetch(`/api/lito/action-drafts/${encodeURIComponent(draftId)}/submit`, {
        method: 'POST',
        headers: { 'x-biz-id': bizId },
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        toast(payload.message || 'No s’ha pogut enviar a revisió', 'error');
        return false;
      }
      toast('Draft enviat a revisió', 'success');
      await fetchDrafts();
      return true;
    } catch {
      toast('No s’ha pogut enviar a revisió', 'error');
      return false;
    } finally {
      setSubmittingDraftId(null);
    }
  }, [bizId, fetchDrafts, toast]);

  const handleSubmitFromEditor = useCallback(async () => {
    if (!editorReviewId) return;

    let draftId = editorDraft?.id || null;
    if (!draftId) {
      draftId = await upsertDraft();
    }
    if (!draftId) return;

    const submitted = await submitDraft(draftId);
    if (submitted) closeDraftEditor();
  }, [closeDraftEditor, editorDraft, editorReviewId, submitDraft, upsertDraft]);

  const decidePendingDraft = useCallback(async (draftId: string, action: 'approve' | 'reject') => {
    if (!bizId) return;

    setDecisionDraftId(draftId);
    try {
      const response = await fetch(`/api/lito/action-drafts/${encodeURIComponent(draftId)}/${action}`, {
        method: 'POST',
        headers: { 'x-biz-id': bizId },
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        toast(payload.message || 'No s’ha pogut actualitzar el draft', 'error');
        return;
      }
      toast(action === 'approve' ? 'Draft aprovat' : 'Draft rebutjat', 'success');
      await fetchDrafts();
    } catch {
      toast('No s’ha pogut actualitzar el draft', 'error');
    } finally {
      setDecisionDraftId(null);
    }
  }, [bizId, fetchDrafts, toast]);

  return (
    <section className="space-y-4">
      <ShellPageHeader
        title="Reviews."
        subtitle="Inbox MVP de ressenyes importades de Google amb workflow editorial."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={status === 'pending' ? 'primary' : 'secondary'}
          onClick={() => {
            setStatus('pending');
            setNextCursor(null);
          }}
        >
          Pendents ({titleStats.pending})
        </Button>
        <Button
          type="button"
          size="sm"
          variant={status === 'replied' ? 'primary' : 'secondary'}
          onClick={() => {
            setStatus('replied');
            setNextCursor(null);
          }}
        >
          Respostes ({titleStats.replied})
        </Button>
        <div className="ml-auto flex flex-col items-end gap-1">
          <Button type="button" size="sm" onClick={() => void handleSyncNow()} loading={syncing}>
            Sync now
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-zinc-500">
            <span>Últim sync: {healthLoading ? 'Carregant…' : formatDateTime(healthLastSyncAt)}</span>
            <span className={`rounded-full border px-2 py-0.5 uppercase ${
              healthStatus === 'ok'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : healthStatus === 'needs_reauth'
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : healthStatus === 'error'
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-black/10 bg-zinc-50 text-zinc-600'
            }`}
            >
              {healthLoading ? '…' : healthStatusLabel(healthStatus)}
            </span>
            {healthStatus === 'error' && healthErrorCode ? (
              <span className="rounded-full border border-black/10 px-2 py-0.5 text-zinc-600">
                {healthErrorCode}
              </span>
            ) : null}
            {healthNeedsReauth ? (
              <a
                href="/dashboard/settings?tab=integrations"
                className="text-brand-accent underline decoration-brand-accent/40 underline-offset-2"
              >
                Reconnecta Google
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {isManagerRole(viewerRole) ? (
        <Card className="space-y-3 border border-black/10 bg-white/95 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Pendents d&apos;aprovació</h3>
              <p className="text-xs text-zinc-500">Només visible per owner/manager.</p>
            </div>
            <span className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] uppercase text-zinc-600">
              {pendingApprovalDrafts.length}
            </span>
          </div>

          {pendingApprovalDrafts.length === 0 ? (
            <p className="text-sm text-zinc-500">No hi ha drafts pendents de revisió.</p>
          ) : (
            <div className="space-y-2">
              {pendingApprovalDrafts.map((draft) => {
                const review = draft.review_id ? reviewMap.get(draft.review_id) : undefined;
                return (
                  <div key={draft.id} className="rounded-xl border border-black/10 bg-white p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">
                          Draft {draftStatusLabel(draft.status)}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-zinc-700">
                          {review?.text_snippet || 'Ressenya vinculada no disponible en aquest filtre.'}
                        </p>
                        <p className="mt-2 line-clamp-3 text-sm text-zinc-900">
                          {draft.suggested_reply || 'Sense text de resposta'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          loading={decisionDraftId === draft.id}
                          onClick={() => void decidePendingDraft(draft.id, 'approve')}
                        >
                          Aprovar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          loading={decisionDraftId === draft.id}
                          onClick={() => void decidePendingDraft(draft.id, 'reject')}
                        >
                          Rebutjar
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      {!bizId ? (
        <Card className="border border-black/10 bg-white/95 p-6 text-sm text-zinc-500">
          Selecciona un negoci actiu per veure la inbox de reviews.
        </Card>
      ) : null}

      {bizId && loading ? (
        <Card className="border border-black/10 bg-white/95 p-6 text-sm text-zinc-500">
          Carregant ressenyes…
        </Card>
      ) : null}

      {bizId && !loading && error ? (
        <Card className="border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {error}
        </Card>
      ) : null}

      {bizId && !loading && !error && items.length === 0 ? (
        <Card className="border border-black/10 bg-white/95 p-6 text-sm text-zinc-500">
          Encara no hi ha ressenyes importades. Fes clic a <strong>Sync now</strong>.
        </Card>
      ) : null}

      {bizId && !loading && !error && items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => {
            const itemDraft = draftsByReviewId.get(item.id) || null;
            const isEditing = editorReviewId === item.id;
            const canSubmit = itemDraft?.status === 'draft' && viewerRole === 'staff';

            return (
              <Card key={item.id} className="border border-black/10 bg-white/95 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900">{renderStars(item.rating)}</span>
                      <span className="text-xs text-zinc-500">{formatDate(item.created_at)}</span>
                      <span className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] uppercase text-zinc-600">
                        {item.reply_status}
                      </span>
                      {itemDraft ? (
                        <span className="rounded-full border border-brand-accent/30 px-2 py-0.5 text-[11px] uppercase text-brand-accent">
                          draft {draftStatusLabel(itemDraft.status)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm text-zinc-700">
                      {item.text_snippet || 'Sense text'}
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {item.author ? `Autor: ${item.author}` : 'Autor: —'}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => openDraftEditor(item.id)}
                      >
                        {itemDraft ? 'Editar draft' : 'Crear draft'}
                      </Button>

                      {canSubmit && itemDraft ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          loading={submittingDraftId === itemDraft.id}
                          onClick={() => void submitDraft(itemDraft.id)}
                        >
                          Enviar a revisió
                        </Button>
                      ) : null}
                    </div>

                    {isEditing ? (
                      <div className="mt-3 rounded-xl border border-black/10 bg-white/80 p-3">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">
                          Editor de draft ({itemDraft ? draftStatusLabel(itemDraft.status) : 'nou'})
                        </p>
                        <textarea
                          value={editorText}
                          onChange={(event) => setEditorText(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-brand-accent/50 focus:ring-2 focus:ring-brand-accent/20"
                          placeholder="Escriu una proposta de resposta per a aquesta ressenya…"
                        />
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void upsertDraft()}
                            loading={savingDraft}
                          >
                            Desar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleSubmitFromEditor()}
                            loading={savingDraft || (editorDraft ? submittingDraftId === editorDraft.id : false)}
                            disabled={viewerRole !== 'staff'}
                            title={viewerRole !== 'staff' ? 'Només staff pot enviar a revisió' : undefined}
                          >
                            Enviar a revisió
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={closeDraftEditor}>
                            Tancar
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-zinc-500">
                    {draftsLoading ? 'Carregant drafts…' : null}
                  </div>
                </div>
              </Card>
            );
          })}

          {nextCursor ? (
            <div className="pt-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void fetchReviews('append')}
                loading={loadingMore}
              >
                Carregar més
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
