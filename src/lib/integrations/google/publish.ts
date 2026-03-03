/**
 * src/lib/integrations/google/publish.ts
 *
 * Google Business Profile — publish/update a reply to a review.
 */

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * Thrown for configuration / implementation gaps that warrant immediate failure
 * without retry (e.g., stub not implemented, missing required field).
 */
export class GbpPermanentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GbpPermanentError';
    this.code = code;
  }
}

/**
 * Thrown for transient API errors that may resolve on retry
 * (e.g., 5xx, network timeout).
 */
export class GbpTransientError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  constructor(code: string, message: string, httpStatus?: number) {
    super(message);
    this.name = 'GbpTransientError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ─── Input / output types ─────────────────────────────────────────────────────

export interface PublishReplyToGoogleInput {
  /** Google OAuth2 access token */
  accessToken: string;
  /** External review ID from reviews.external_id (Google's review resource name/ID) */
  externalReviewId: string;
  /** Final reply text to publish */
  replyText: string;
  /** Google Place ID from businesses.google_place_id (used to build the API path) */
  googlePlaceId?: string;
}

export interface PublishReplyToGoogleResult {
  /** Google's assigned reply ID (from the API response), if available */
  gbpReplyId?: string;
}

type GoogleErrorPayload = {
  error?: {
    code?: number;
    status?: string;
    message?: string;
  };
  reviewReply?: {
    updateTime?: string;
  };
};

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeReviewResource(externalReviewId: string): string | null {
  const normalized = asString(externalReviewId);
  if (!normalized) return null;

  if (normalized.startsWith('accounts/') && normalized.includes('/reviews/')) {
    return normalized;
  }
  if (normalized.includes('/reviews/')) {
    return normalized.replace(/^\/+/, '');
  }

  return null;
}

function toGoogleErrorMessage(payload: GoogleErrorPayload | null): string {
  const status = asString(payload?.error?.status);
  const message = asString(payload?.error?.message);
  if (status && message) return `${status}: ${message}`;
  return message || status || 'google_publish_failed';
}

function toGoogleErrorCode(payload: GoogleErrorPayload | null): string {
  const status = asString(payload?.error?.status);
  return status || 'google_publish_failed';
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Publish a reply to Google Business Profile.
 *
 * @throws GbpPermanentError  — don't retry (bad input / auth revoked / not found)
 * @throws GbpTransientError  — retry with backoff (5xx / network error)
 */
export async function publishReplyToGoogle(
  input: PublishReplyToGoogleInput,
): Promise<PublishReplyToGoogleResult> {
  const accessToken = asString(input.accessToken);
  const replyText = asString(input.replyText);
  const reviewResource = normalizeReviewResource(input.externalReviewId);

  if (!accessToken) {
    throw new GbpPermanentError('connector_auth_failed', 'Missing Google access token');
  }
  if (!replyText) {
    throw new GbpPermanentError('reply_content_invalid', 'Reply content is empty');
  }
  if (!reviewResource) {
    throw new GbpPermanentError('review_external_id_invalid', 'review.external_id must include the GBP review resource');
  }

  const endpoint = `https://mybusiness.googleapis.com/v4/${reviewResource}/reply`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ comment: replyText }),
      cache: 'no-store',
    });
  } catch (error) {
    throw new GbpTransientError(
      'google_network_error',
      error instanceof Error ? error.message : 'Network error publishing Google reply',
    );
  }

  const payload = await response.json().catch(() => null) as GoogleErrorPayload | null;

  if (response.ok) {
    return {
      gbpReplyId: asString(payload?.reviewReply?.updateTime) || undefined,
    };
  }

  const code = toGoogleErrorCode(payload);
  const message = toGoogleErrorMessage(payload);

  if (response.status === 429 || response.status >= 500) {
    throw new GbpTransientError(code, message, response.status);
  }

  if (response.status === 401 || response.status === 403) {
    throw new GbpPermanentError('connector_auth_failed', message);
  }

  throw new GbpPermanentError(code, message);
}
