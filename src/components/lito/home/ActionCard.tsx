'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ActionCard as LitoActionCard, ActionCardCta } from '@/types/lito-cards';

export type ReviewCardGenerateInput = {
  card: LitoActionCard;
  reviewId: string;
  reviewText: string;
  stars: number | null;
};

export type ReviewCardSaveDraftInput = {
  card: LitoActionCard;
  reviewId: string;
  responseText: string;
};

type ActionCardProps = {
  card: LitoActionCard;
  busy?: boolean;
  onAction: (card: LitoActionCard, cta: ActionCardCta) => void;
  onGenerateReviewResponse?: (input: ReviewCardGenerateInput) => Promise<string | null>;
  onSaveReviewDraft?: (input: ReviewCardSaveDraftInput) => Promise<boolean>;
};

function severityLabel(value: LitoActionCard['severity']): string {
  if (value === 'high') return 'Alta';
  if (value === 'medium') return 'Mitjana';
  return 'Baixa';
}

function findRef(card: LitoActionCard, kind: string): string | null {
  const hit = card.refs.find((entry) => entry.kind === kind);
  return hit?.id || null;
}

function payloadValueAsString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function payloadValueAsNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export default function ActionCard({
  card,
  busy = false,
  onAction,
  onGenerateReviewResponse,
  onSaveReviewDraft,
}: ActionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatedResponse, setGeneratedResponse] = useState('');
  const [editableResponse, setEditableResponse] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setExpanded(false);
    setGenerating(false);
    setSaving(false);
    setGeneratedResponse('');
    setEditableResponse('');
    setLocalError(null);
  }, [card.id]);

  const reviewContext = useMemo(() => {
    if (card.type !== 'review_unanswered') return null;
    const payload = card.primary_cta.payload || card.secondary_cta?.payload || {};
    const reviewId = payloadValueAsString(payload, 'review_id') || findRef(card, 'review_id');
    const reviewText = payloadValueAsString(payload, 'comment_preview') || '';
    const stars = payloadValueAsNumber(payload, 'star_rating');
    if (!reviewId) return null;
    return {
      reviewId,
      reviewText,
      stars,
      allowGenerate: card.primary_cta.action === 'view_response',
    };
  }, [card]);

  const canToggleInline = card.type === 'review_unanswered'
    && (card.primary_cta.action === 'view_response' || card.primary_cta.action === 'view_only');

  const handleGenerateResponse = useCallback(async () => {
    if (!reviewContext?.allowGenerate || !onGenerateReviewResponse || generating) return;
    setGenerating(true);
    setLocalError(null);

    try {
      const generated = await onGenerateReviewResponse({
        card,
        reviewId: reviewContext.reviewId,
        reviewText: reviewContext.reviewText,
        stars: reviewContext.stars,
      });
      if (!generated) {
        setLocalError('No he pogut generar la resposta.');
        return;
      }
      setGeneratedResponse(generated);
      setEditableResponse(generated);
    } catch {
      setLocalError('No he pogut generar la resposta.');
    } finally {
      setGenerating(false);
    }
  }, [reviewContext, onGenerateReviewResponse, generating, card]);

  const handleSaveDraft = useCallback(async () => {
    if (!reviewContext || !onSaveReviewDraft || saving) return;
    const responseText = editableResponse.trim();
    if (!responseText) {
      setLocalError('Afegeix una resposta abans de guardar.');
      return;
    }

    setSaving(true);
    setLocalError(null);
    try {
      const ok = await onSaveReviewDraft({
        card,
        reviewId: reviewContext.reviewId,
        responseText,
      });
      if (!ok) {
        setLocalError('No he pogut guardar l’esborrany.');
      }
    } catch {
      setLocalError('No he pogut guardar l’esborrany.');
    } finally {
      setSaving(false);
    }
  }, [reviewContext, onSaveReviewDraft, saving, editableResponse, card]);

  const handlePrimaryAction = useCallback(() => {
    if (canToggleInline) {
      setExpanded((prev) => !prev);
      setLocalError(null);
      return;
    }
    onAction(card, card.primary_cta);
  }, [canToggleInline, onAction, card]);

  const canSaveDraft = reviewContext?.allowGenerate && editableResponse.trim().length > 0;

  return (
    <article className={`lito-action-card severity-${card.severity}`}>
      <div className="lito-action-card-head">
        <span className="lito-action-card-type">{card.type.replace('_', ' ')}</span>
        <span className="lito-action-card-severity">{severityLabel(card.severity)}</span>
      </div>

      <h3 className="lito-action-card-title">{card.title}</h3>
      <p className="lito-action-card-subtitle">{card.subtitle}</p>

      <div className="lito-action-card-actions">
        <button
          type="button"
          className="lito-action-card-primary"
          disabled={busy}
          onClick={handlePrimaryAction}
        >
          {card.primary_cta.label}
        </button>
        {card.secondary_cta ? (
          <button
            type="button"
            className="lito-action-card-secondary"
            disabled={busy}
            onClick={() => onAction(card, card.secondary_cta as ActionCardCta)}
          >
            {card.secondary_cta.label}
          </button>
        ) : null}
      </div>

      {expanded && reviewContext ? (
        <section className="lito-action-review-inline">
          <p className="lito-action-review-label">Ressenya</p>
          <p className="lito-action-review-preview">
            {reviewContext.reviewText || 'Sense text a la ressenya.'}
          </p>

          {reviewContext.allowGenerate ? (
            <>
              <div className="lito-action-review-controls">
                <button
                  type="button"
                  className="lito-action-card-secondary"
                  disabled={busy || generating || saving}
                  onClick={() => {
                    void handleGenerateResponse();
                  }}
                >
                  {generating ? 'Generant…' : 'Generar resposta'}
                </button>
              </div>

              {generatedResponse ? (
                <textarea
                  ref={textareaRef}
                  className="lito-action-review-textarea"
                  value={editableResponse}
                  onChange={(event) => setEditableResponse(event.target.value)}
                  rows={4}
                />
              ) : null}

              {generatedResponse ? (
                <div className="lito-action-review-controls">
                  <button
                    type="button"
                    className="lito-action-card-primary"
                    disabled={busy || saving || !canSaveDraft}
                    onClick={() => {
                      void handleSaveDraft();
                    }}
                  >
                    {saving ? 'Guardant…' : 'Queda’t'}
                  </button>
                  <button
                    type="button"
                    className="lito-action-card-secondary"
                    disabled={busy || saving}
                    onClick={() => {
                      textareaRef.current?.focus();
                    }}
                  >
                    Canvia alguna cosa
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {localError ? (
            <p className="lito-action-review-error">{localError}</p>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}
