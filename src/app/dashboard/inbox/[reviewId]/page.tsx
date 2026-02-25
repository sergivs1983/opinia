'use client';

export const dynamic = 'force-dynamic';


import { useT } from '@/components/i18n/I18nContext';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import Badge from '@/components/ui/Badge';
import StarRating from '@/components/ui/StarRating';
import { glassStrong, glassActive, textMain, textSub, textMuted } from '@/components/ui/glass';
import { cn, sentimentEmoji, sentimentLabel, sentimentColor, sourceIcon, sourceLabel, timeAgo, toneLabel, toneIcon, toneBg, toneBadge, toneDescription, statusLabel, statusColor } from '@/lib/utils';
import type { Review, Reply, ReplyTone, GuardrailWarning, KnowledgeBaseEntry } from '@/types/database';

type Modifier = 'shorter' | 'formal' | 'empathic' | 'assertive';

const MODIFIERS: { key: Modifier; label: string; icon: string }[] = [
  { key: 'shorter', label: 'Més curt', icon: '✂️' },
  { key: 'formal', label: 'Més formal', icon: '👔' },
  { key: 'empathic', label: 'Més empàtic', icon: '💛' },
  { key: 'assertive', label: 'Més assertiu', icon: '💪' },
];

const TONES: ReplyTone[] = ['proper', 'professional', 'premium'];

type GenerateErrorState = {
  message: string;
  requestId: string | null;
};

type TriggerFired = { triggerId: string; triggerName: string };

type ReviewClassification = {
  topics?: string[];
  urgency?: string;
  [key: string]: unknown;
};

type GenerateResponsePayload = {
  error?: string;
  message?: string;
  request_id?: string;
  guardrail_warnings?: GuardrailWarning[];
  matched_kb?: KnowledgeBaseEntry[];
  classification?: ReviewClassification | null;
  triggers_fired?: TriggerFired[];
};

export default function ReviewDetailPage() {
  const t = useT();
  const params = useParams();
  const reviewId = params.reviewId as string;
  const { biz } = useWorkspace();
  const router = useRouter();
  const supabase = createClient();

  const [review, setReview] = useState<Review | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedTone, setSelectedTone] = useState<ReplyTone>('professional');
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<GuardrailWarning[]>([]);
  const [guardrailAcknowledged, setGuardrailAcknowledged] = useState(false);
  const [approving, setApproving] = useState(false);
  const [triggersFired, setTriggersFired] = useState<TriggerFired[]>([]);

  // Phase B state
  const [matchedKB, setMatchedKB] = useState<KnowledgeBaseEntry[]>([]);
  const [classification, setClassification] = useState<ReviewClassification | null>(null);
  const [showKBPanel, setShowKBPanel] = useState(true);

  useEffect(() => {
    if (!reviewId || !biz) return;
    loadData();
  }, [reviewId, biz]);

  const loadData = async () => {
    setLoading(true);
    const [reviewRes, repliesRes] = await Promise.all([
      supabase.from('reviews').select('*').eq('id', reviewId).single(),
      supabase.from('replies').select('*').eq('review_id', reviewId).order('created_at', { ascending: false }),
    ]);
    setReview(reviewRes.data as Review);
    setReplies((repliesRes.data as Reply[]) || []);
    setLoading(false);
  };

  // Phase D: usage limit error
  const [usageError, setUsageError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<GenerateErrorState | null>(null);
  const [copiedRequestId, setCopiedRequestId] = useState(false);

  const handleCopyRequestId = async () => {
    if (!generateError?.requestId) return;
    await navigator.clipboard.writeText(generateError.requestId);
    setCopiedRequestId(true);
    window.setTimeout(() => setCopiedRequestId(false), 1500);
  };

  const handleGenerate = async (modifier?: Modifier) => {
    if (!review || !biz) return;
    setGenerating(true);
    setWarnings([]);
    setGuardrailAcknowledged(false);
    setEditedContent({});
    setMatchedKB([]);
    setClassification(null);
    setUsageError(null);
    setGenerateError(null);
    setCopiedRequestId(false);
    setTriggersFired([]);

    try {
      const res = await fetch(`/api/reviews/${reviewId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: review.source,
          rating: review.rating,
          language: review.language_detected,
          regenerate: replies.length > 0,
          modifier,
        }),
      });
      const data = await res.json().catch(() => ({})) as GenerateResponsePayload;
      const requestIdHeader = res.headers.get('x-request-id')?.trim() || null;
      const requestIdBody = typeof data.request_id === 'string' && data.request_id.trim().length > 0
        ? data.request_id.trim()
        : null;
      const requestId = requestIdBody || requestIdHeader;
      const errorCode = typeof data.error === 'string' ? data.error : null;
      const errorMessage = typeof data.message === 'string' ? data.message : 'No s\'ha pogut generar la resposta.';

      if (errorCode === 'usage_limit') {
        setUsageError(errorMessage);
        setGenerateError({ message: errorMessage, requestId });
        setGenerating(false);
        return;
      }
      if (errorCode === 'panic_mode_enabled') {
        const panicMessage = `🚨 ${errorMessage}`;
        setUsageError(panicMessage);
        setGenerateError({ message: panicMessage, requestId });
        setGenerating(false);
        return;
      }
      if (!res.ok || errorCode) {
        setGenerateError({ message: errorMessage, requestId });
        setGenerating(false);
        return;
      }

      setWarnings(data.guardrail_warnings || []);
      setMatchedKB(data.matched_kb || []);
      setClassification(data.classification || null);
      setTriggersFired(data.triggers_fired || []);
      await loadData();
      setGenerateError(null);
    } catch (err) {
      console.error('Generation failed:', err);
      setGenerateError({
        message: err instanceof Error ? err.message : 'No s\'ha pogut generar la resposta.',
        requestId: null,
      });
    }
    setGenerating(false);
  };

  const handleApprove = async () => {
    const currentReply = replies.find(r => r.tone === selectedTone);
    if (!currentReply) return;

    const hasWarnings = warnings.filter(w => w.tone === selectedTone).length > 0;
    if (hasWarnings && !guardrailAcknowledged) return;

    setApproving(true);
    const finalContent = editedContent[selectedTone] || currentReply.content;

    await supabase.from('replies').update({
      status: 'published',
      content: finalContent,
      is_edited: !!editedContent[selectedTone],
      published_at: new Date().toISOString(),
    }).eq('id', currentReply.id);

    const otherIds = replies.filter(r => r.id !== currentReply.id).map(r => r.id);
    if (otherIds.length) {
      await supabase.from('replies').update({ status: 'archived' }).in('id', otherIds);
    }

    await supabase.from('reviews').update({ is_replied: true }).eq('id', reviewId);
    setApproving(false);
    router.push('/dashboard/inbox');
  };

  const currentReply = replies.find(r => r.tone === selectedTone);
  const currentContent = editedContent[selectedTone] || currentReply?.content || '';
  const currentWarnings = warnings.filter(w => w.tone === selectedTone);
  const hasUnacknowledgedWarnings = currentWarnings.length > 0 && !guardrailAcknowledged;

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh]"><div className="w-5 h-5 border-2 border-white/25 border-t-brand-accent rounded-full animate-spin" /></div>;
  }
  if (!review) {
    return <div className="flex items-center justify-center h-[60vh] text-white/55">Ressenya no trobada</div>;
  }

  return (
    <div className="flex h-[calc(100vh-52px)] gap-4" data-testid="review-detail-page">
      {/* LEFT — Review + KB Matches */}
      <div className={cn('w-[420px] shrink-0 overflow-y-auto', glassStrong)}>
        {/* Back + Delete */}
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
          <button onClick={() => router.push('/dashboard/inbox')} className={cn('flex items-center gap-1.5 text-sm transition-colors', textSub, 'hover:text-white/92')}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Inbox
          </button>
          <button onClick={async () => {
            if (!confirm('Eliminar aquesta ressenya i les seves respostes?')) return;
            await supabase.from('replies').delete().eq('review_id', reviewId);
            await supabase.from('reviews').delete().eq('id', reviewId);
            router.push('/dashboard/inbox');
          }} className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/45 hover:text-red-300 transition-all" title="Eliminar">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        {/* Review header */}
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className={cn('w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shrink-0',
              review.rating >= 4 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35' : review.rating === 3 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/35' : 'bg-red-500/20 text-red-300 border border-red-500/35')}>
              {review.rating}★
            </div>
            <div className="min-w-0">
              <p className={cn('font-semibold', textMain)}>{review.author_name || 'Anònim'}</p>
              <div className={cn('flex items-center gap-2 text-xs', textMuted)}>
                <span>{sourceIcon(review.source)} {sourceLabel(review.source)}</span>
                <span>{timeAgo(review.review_date || review.created_at)}</span>
              </div>
            </div>
          </div>

          <StarRating rating={review.rating} readonly size="sm" />

          <div className="flex gap-2">
            <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', sentimentColor(review.sentiment))}>
              {sentimentEmoji(review.sentiment)} {sentimentLabel(review.sentiment)}
            </span>
            <Badge variant="default" className="text-xs">{review.language_detected?.toUpperCase()}</Badge>
          </div>

          {/* Classification badges (Phase B) */}
          {classification && (
            <div className="flex gap-1.5 flex-wrap">
              {classification.topics?.map((t: string, i: number) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/12 text-indigo-200 border border-indigo-500/30 font-medium">
                  {t}
                </span>
              ))}
              {classification.urgency && classification.urgency !== 'low' && (
                <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-bold uppercase',
                  classification.urgency === 'critical' ? 'bg-red-500/20 text-red-300 border border-red-500/35 animate-pulse' :
                  classification.urgency === 'high' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/35' : 'bg-white/8 text-white/65 border border-white/15')}>
                  {classification.urgency}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Review text */}
        <div className="px-5 pb-5">
          <p className={cn('text-sm leading-relaxed whitespace-pre-wrap', textSub)}>{review.review_text}</p>
        </div>

        <div className="h-px bg-white/10 mx-5" />

        {/* Business Memory Used (Phase B) */}
        <div className="p-5">
          <button onClick={() => setShowKBPanel(!showKBPanel)} className={cn('flex items-center justify-between w-full text-sm font-medium', textMain)}>
            <span className="flex items-center gap-2">
              🧠 Business Memory
              {matchedKB.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 font-bold">{matchedKB.length} usades</span>
              )}
            </span>
            <svg className={cn('w-4 h-4 text-white/45 transition-transform', showKBPanel && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showKBPanel && (
            <div className="mt-3 space-y-2 animate-fade-in">
              {matchedKB.length === 0 ? (
                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                  <p className="text-xs text-white/55">
                    {replies.length === 0
                      ? 'Genera respostes per veure quines entrades de memòria es fan servir.'
                      : 'Cap entrada activada per aquesta ressenya. Afegeix triggers rellevants a Settings → Business Memory.'}
                  </p>
                </div>
              ) : matchedKB.map((entry: any, i: number) => (
                <div key={i} className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 uppercase font-bold">{entry.category}</span>
                  </div>
                  <p className="text-xs text-white/78 leading-relaxed">{entry.content}</p>
                  {entry.triggers?.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-1.5">
                      {entry.triggers.map((t: string, j: number) => (
                        <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/8 text-emerald-300 border border-emerald-500/30">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Triggers Fired panel */}
      {triggersFired.length > 0 && (
        <div className="px-6 pb-4">
          <div className="rounded-xl bg-amber-500/12 border border-amber-500/35 p-3">
            <p className="text-xs font-semibold text-amber-300 mb-2">⚡ Triggers Fired ({triggersFired.length})</p>
            <div className="space-y-1">
              {triggersFired.map(t => (
                <div key={t.triggerId} className="flex items-center gap-2 text-xs text-amber-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-300" />
                  {t.triggerName}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* RIGHT — Composer */}
      <div className={cn('flex-1 flex flex-col min-w-0', glassStrong)}>
        {/* Tone tabs */}
        <div className="px-6 py-3 border-b border-white/10 flex items-center gap-2">
          {TONES.map(tone => (
            <Chip key={tone} active={selectedTone === tone} onClick={() => { setSelectedTone(tone); setGuardrailAcknowledged(false); }}>
              {toneIcon(tone)} {toneLabel(tone)}
            </Chip>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {replies.length === 0 ? (
              <Button onClick={() => handleGenerate()} loading={generating} data-testid="review-generate">
                {t('dashboard.inbox.generateResponses')}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => handleGenerate()} loading={generating} data-testid="review-generate">
                {t('dashboard.inbox.regenerate')}
              </Button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {replies.length === 0 && !generating ? (
            <div className="flex items-center justify-center h-full text-white/55">
              <div className="text-center">
                {usageError ? (
                  <>
                    <p className="text-3xl mb-3">⚡</p>
                    <p className="font-medium text-amber-300 mb-1">Límit assolit</p>
                    <p className="text-sm text-amber-200 mb-4 max-w-md">{usageError}</p>
                    {generateError?.requestId && (
                      <div className="mb-4 rounded-lg border border-amber-500/35 bg-amber-500/12 px-3 py-2 text-left" data-testid="generate-error-box">
                        <p className="text-xs font-medium text-amber-200" data-testid="generate-error-request-id">ID: {generateError.requestId}</p>
                        <button
                          type="button"
                          onClick={handleCopyRequestId}
                          className="mt-2 text-xs font-medium text-amber-200 underline underline-offset-2 hover:text-amber-100"
                          data-testid="generate-error-copy-id"
                        >
                          {copiedRequestId ? 'ID copiat' : 'Copia ID'}
                        </button>
                      </div>
                    )}
                    <Button variant="secondary" onClick={() => window.location.href = '/dashboard/settings'}>
                      💳 Veure plans
                    </Button>
                  </>
                ) : generateError ? (
                  <div className="text-left max-w-md" data-testid="generate-error-box">
                    <p className="text-3xl mb-3">⚠️</p>
                    <p className="font-medium text-red-300 mb-1">No s&apos;ha pogut generar la resposta</p>
                    <p className="text-sm text-red-200 mb-3">{generateError.message}</p>
                    {generateError.requestId && (
                      <>
                        <p className="text-xs text-red-300 font-medium mb-2" data-testid="generate-error-request-id">ID: {generateError.requestId}</p>
                        <button
                          type="button"
                          onClick={handleCopyRequestId}
                          className="text-xs font-medium text-red-300 underline underline-offset-2 hover:text-red-200"
                          data-testid="generate-error-copy-id"
                        >
                          {copiedRequestId ? 'ID copiat' : 'Copia ID'}
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="text-4xl mb-3">✨</p>
                    <p className={cn('font-medium mb-1', textMain)}>Genera respostes IA per a aquesta ressenya</p>
                    <p className={cn('text-xs mb-4', textMuted)}>El pipeline analitzarà la ressenya, buscarà fets al Business Memory, i generarà 3 opcions.</p>
                    <Button onClick={() => handleGenerate()} data-testid="review-generate">{t('dashboard.inbox.generateResponses')}</Button>
                  </>
                )}
              </div>
            </div>
          ) : generating ? (
            <div className="space-y-4">
              <div className={cn('flex items-center gap-3 text-sm animate-fade-in', textSub)}>
                <div className="w-4 h-4 border-2 border-white/25 border-t-brand-accent rounded-full animate-spin" />
                <span>Pipeline IA en marxa — classifica, busca memòria, genera, valida...</span>
              </div>
              {[0, 1, 2].map(i => (
                <div key={i} className="bg-white/8 rounded-xl border border-white/14 p-5 animate-pulse" style={{ animationDelay: `${i * 150}ms` }}>
                  <div className="space-y-2"><div className="h-3 bg-white/20 rounded w-full" /><div className="h-3 bg-white/15 rounded w-5/6" /><div className="h-3 bg-white/15 rounded w-4/6" /></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {generateError && !usageError && (
                <div className="rounded-xl border border-red-500/35 bg-red-500/12 p-4 text-sm text-red-300" data-testid="generate-error-box">
                  <p className="font-semibold">No s&apos;ha pogut regenerar la resposta.</p>
                  <p className="mt-1">{generateError.message}</p>
                  {generateError.requestId && (
                    <div className="mt-3 flex items-center gap-3">
                      <p className="text-xs font-medium" data-testid="generate-error-request-id">ID: {generateError.requestId}</p>
                      <button
                        type="button"
                        onClick={handleCopyRequestId}
                        className="text-xs font-medium underline underline-offset-2 hover:text-red-800"
                        data-testid="generate-error-copy-id"
                      >
                        {copiedRequestId ? 'ID copiat' : 'Copia ID'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Tone badge */}
              <div className="flex items-center gap-2 text-sm">
                <span className={cn('px-2.5 py-1 rounded-full text-xs font-bold', toneBadge(selectedTone))}>
                  {toneIcon(selectedTone)} {toneLabel(selectedTone)}
                </span>
                <span className={textSub}>{toneDescription(selectedTone)}</span>
              </div>

              {/* Reply card */}
              <div className={cn(glassActive, 'p-5 space-y-3')}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="brand">Reply Card</Badge>
                  <Chip active={Boolean(biz?.seo_enabled)}>
                    SEO {biz?.seo_enabled ? 'ON' : 'OFF'}
                  </Chip>
                  <Badge variant={currentWarnings.length > 0 ? 'danger' : 'success'}>
                    Guardrails: {currentWarnings.length}
                  </Badge>
                </div>
                <textarea
                  value={currentContent}
                  onChange={e => setEditedContent(prev => ({ ...prev, [selectedTone]: e.target.value }))}
                  data-testid="review-response-editor"
                  className="w-full min-h-[200px] text-sm text-white/90 leading-relaxed bg-transparent resize-y focus:outline-none"
                  placeholder="La resposta apareixerà aquí..."
                />
              </div>

              {/* Guardrail warnings */}
              {currentWarnings.length > 0 && (
                <div className="bg-red-500/12 border border-red-500/35 rounded-xl p-4 animate-fade-in">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-red-300 font-bold text-sm">⚠️ Guardrails activats</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-200 border border-red-500/35 font-medium">{currentWarnings.length} avís{currentWarnings.length > 1 ? 'os' : ''}</span>
                  </div>
                  <p className="text-xs text-red-200 mb-3">Aquesta resposta pot contenir informació no validada pel Business Memory.</p>
                  <ul className="space-y-1.5">
                    {currentWarnings.map((w, i) => (
                      <li key={i} className="text-sm text-red-200 flex items-start gap-2">
                        <span className="shrink-0 mt-0.5">🔴</span>
                        <span><strong>{w.text}</strong>: <code className="bg-red-500/20 px-1 py-0.5 rounded text-xs">{w.span}</code></span>
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2 mt-3 text-sm text-red-200 cursor-pointer">
                    <input type="checkbox" checked={guardrailAcknowledged} onChange={e => setGuardrailAcknowledged(e.target.checked)}
                      className="rounded border-red-400/40 text-red-500 focus:ring-red-500" />
                    He revisat i confirmo que la informació és correcta
                  </label>
                </div>
              )}

              {/* Modifiers */}
              <div>
                <p className={cn('text-[10px] uppercase font-bold tracking-wider mb-2', textMuted)}>Ajustar to</p>
                <div className="flex gap-2 flex-wrap">
                  {MODIFIERS.map(m => (
                    <button key={m.key} onClick={() => handleGenerate(m.key)} disabled={generating}
                      className="px-3 py-1.5 rounded-lg border border-white/15 text-xs font-medium text-white/72 hover:bg-white/8 hover:border-white/25 transition-all disabled:opacity-50">
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {currentReply && currentReply.status !== 'draft' && (
                <div className={cn('inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full', statusColor(currentReply.status))}>
                  {statusLabel(currentReply.status)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom bar */}
        {replies.length > 0 && (
          <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => { navigator.clipboard.writeText(currentContent); }}
                className="px-3 py-2 rounded-lg border border-white/15 text-sm text-white/72 hover:bg-white/10 transition-all">
                📋 Copiar
              </button>
              <span className={cn('text-xs', textMuted)}>{currentContent.length} chars</span>
            </div>
            <Button size="lg" onClick={handleApprove} loading={approving}
              disabled={!currentContent || hasUnacknowledgedWarnings || currentReply?.status === 'published'}
              className={cn(currentReply?.status === 'published' && 'opacity-50')}>
              {currentReply?.status === 'published' ? '✅ Publicada' : 'Aprovar i publicar'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
