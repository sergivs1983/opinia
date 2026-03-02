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

function parseLocationId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/locations\/(\d+)/);
  return match?.[1] || null;
}

function buildGoogleReviewUrl(input: {
  gbpReviewId: string | null;
  locationName: string | null;
  locationId: string | null;
  businessName: string | null;
}): string {
  const directLocationId = parseLocationId(input.locationName) || parseLocationId(input.locationId);
  if (directLocationId && input.gbpReviewId) {
    const reviewId = encodeURIComponent(input.gbpReviewId);
    return `https://business.google.com/reviews/l/${directLocationId}?reviewId=${reviewId}`;
  }
  if (directLocationId) {
    return `https://business.google.com/reviews/l/${directLocationId}`;
  }

  const q = input.businessName?.trim()
    ? `${input.businessName.trim()} Google reviews`
    : 'Google business reviews';
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
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
    const gbpReviewId = payloadValueAsString(payload, 'gbp_review_id') || findRef(card, 'gbp_review_id');
    const businessName = payloadValueAsString(payload, 'business_name');
    const googleLocationName = payloadValueAsString(payload, 'google_location_name');
    const googleLocationId = payloadValueAsString(payload, 'google_location_id');
    if (!reviewId) return null;
    return {
      reviewId,
      reviewText,
      stars,
      gbpReviewId,
      businessName,
      googleLocationName,
      googleLocationId,
      allowGenerate: card.primary_cta.action === 'view_response',
    };
  }, [card]);

  const googleReviewUrl = useMemo(() => buildGoogleReviewUrl({
    gbpReviewId: reviewContext?.gbpReviewId || null,
    locationName: reviewContext?.googleLocationName || null,
    locationId: reviewContext?.googleLocationId || null,
    businessName: reviewContext?.businessName || null,
  }), [
    reviewContext?.gbpReviewId,
    reviewContext?.googleLocationName,
    reviewContext?.googleLocationId,
    reviewContext?.businessName,
  ]);

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

  const handleCopyResponse = useCallback(() => {
    const responseText = editableResponse.trim();
    if (!responseText) {
      setLocalError('Genera o escriu una resposta abans de copiar.');
      return;
    }

    onAction(card, {
      label: 'Copiar resposta',
      action: 'copy_open',
      payload: {
        ...(card.primary_cta.payload || {}),
        copy_text: responseText,
      },
    });
    setLocalError(null);
  }, [card, editableResponse, onAction]);

  const handleOpenGoogle = useCallback(() => {
    window.open(googleReviewUrl, '_blank', 'noopener,noreferrer');
  }, [googleReviewUrl]);

  const handleMarkDone = useCallback(() => {
    if (!reviewContext) return;
    onAction(card, {
      label: 'Ja està',
      action: 'mark_done',
      payload: {
        review_id: reviewContext.reviewId,
        card_id: card.id,
      },
    });
  }, [reviewContext, onAction, card]);

  const handleSnooze = useCallback(() => {
    if (!reviewContext) return;
    onAction(card, {
      label: 'Demà va millor',
      action: 'snooze',
      payload: {
        review_id: reviewContext.reviewId,
        card_id: card.id,
        snooze_hours: 24,
      },
    });
  }, [reviewContext, onAction, card]);

  const canSaveDraft = reviewContext?.allowGenerate && editableResponse.trim().length > 0;
  const canCopyResponse = editableResponse.trim().length > 0;

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

              <div className="lito-action-review-controls lito-action-review-ikea">
                <button
                  type="button"
                  className="lito-action-card-secondary"
                  disabled={busy || generating || saving || !canCopyResponse}
                  onClick={handleCopyResponse}
                >
                  Copiar resposta
                </button>
                <button
                  type="button"
                  className="lito-action-card-secondary"
                  disabled={busy || generating || saving}
                  onClick={handleOpenGoogle}
                >
                  Obrir Google
                </button>
              </div>

              <div className="lito-action-review-controls lito-action-review-ikea">
                <button
                  type="button"
                  className="lito-action-card-primary"
                  disabled={busy || generating || saving}
                  onClick={handleMarkDone}
                >
                  Ja està
                </button>
                <button
                  type="button"
                  className="lito-action-card-secondary"
                  disabled={busy || generating || saving}
                  onClick={handleSnooze}
                >
                  Demà va millor
                </button>
              </div>
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
