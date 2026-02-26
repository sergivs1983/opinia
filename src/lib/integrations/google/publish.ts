/**
 * src/lib/integrations/google/publish.ts
 *
 * Google Business Profile — publish a reply to a review.
 *
 * TODO (GBP-IMPL): Implement real API call before production:
 *   PATCH https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews/{reviewId}/reply
 *   Headers: Authorization: Bearer <accessToken>, Content-Type: application/json
 *   Body:    { "comment": "<replyText>" }
 *   Success: 200 with updated review object
 *   Error:   4xx/5xx — parse and propagate
 *
 * Until implemented, every call throws GbpNotImplementedError which the worker
 * treats as a permanent failure (no retry).
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
  /** External review ID from reviews.external_id (Google's review name/ID) */
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

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Publish a reply to Google Business Profile.
 *
 * @throws GbpPermanentError  — don't retry (stub / bad input / auth revoked)
 * @throws GbpTransientError  — retry with backoff (5xx / network error)
 *
 * TODO (GBP-IMPL): Replace stub with real PATCH call (see file header).
 */
export async function publishReplyToGoogle(
  _input: PublishReplyToGoogleInput,
): Promise<PublishReplyToGoogleResult> {
  // Stub: throw permanent error to force job → failed (no retry loop).
  // Replace this entire function body with the real API call.
  throw new GbpPermanentError(
    'gbp_not_implemented',
    'TODO (GBP-IMPL): publishReplyToGoogle is a stub — implement real GBP PATCH before production',
  );
}
