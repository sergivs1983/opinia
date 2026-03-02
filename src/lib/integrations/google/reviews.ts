type GoogleApiError = {
  status?: string;
  message?: string;
};

type GoogleReviewApiPayload = {
  reviews?: Array<Record<string, unknown>>;
  nextPageToken?: string;
  error?: GoogleApiError;
};

type GoogleRefreshTokenPayload = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

export type GbpReviewSyncItem = {
  gbpReviewId: string;
  starRating: number;
  commentPreview: string;
  reviewerLabel: string;
  createTime: string;
  hasReply: boolean;
  replyTime: string | null;
};

export type GoogleReviewsListResult =
  | {
      ok: true;
      reviews: GbpReviewSyncItem[];
      locationResource: string;
      fetched: number;
    }
  | {
      ok: false;
      httpStatus: number;
      errorCode: string | null;
      errorMessage: string | null;
      locationResource: string | null;
    };

export type GoogleRefreshAccessTokenResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      expiresIn: number | null;
    }
  | {
      ok: false;
      httpStatus: number;
      errorCode: string | null;
      errorMessage: string | null;
    };

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function redactCommentPreview(value: unknown): string {
  const raw = asString(value);
  if (!raw) return '';

  const redacted = compactWhitespace(raw)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:https?:\/\/|www\.)\S+\b/gi, '[link]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]');

  return redacted.slice(0, 280);
}

function parseStarRating(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    if (normalized >= 1 && normalized <= 5) return normalized;
    return null;
  }

  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;

  if (/^[1-5]$/.test(normalized)) return Number.parseInt(normalized, 10);

  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
    STAR_RATING_ONE: 1,
    STAR_RATING_TWO: 2,
    STAR_RATING_THREE: 3,
    STAR_RATING_FOUR: 4,
    STAR_RATING_FIVE: 5,
  };

  return map[normalized] ?? null;
}

function parseIsoDate(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseReviewId(row: Record<string, unknown>): string | null {
  const explicit = asString(row.reviewId);
  if (explicit) return explicit;

  const name = asString(row.name);
  if (!name) return null;
  return name;
}

function parseReview(row: Record<string, unknown>): GbpReviewSyncItem | null {
  const gbpReviewId = parseReviewId(row);
  const starRating = parseStarRating(row.starRating);
  const createTime = parseIsoDate(row.createTime);

  if (!gbpReviewId || !starRating || !createTime) return null;

  const reviewReply = (row.reviewReply && typeof row.reviewReply === 'object')
    ? row.reviewReply as Record<string, unknown>
    : null;
  const replyComment = reviewReply ? asString(reviewReply.comment) : null;
  const replyTime = reviewReply ? parseIsoDate(reviewReply.updateTime) : null;

  return {
    gbpReviewId,
    starRating,
    commentPreview: redactCommentPreview(row.comment),
    reviewerLabel: 'Un client',
    createTime,
    hasReply: Boolean(replyComment),
    replyTime: replyComment ? replyTime : null,
  };
}

function mapError(payload: GoogleReviewApiPayload | null): {
  code: string | null;
  message: string | null;
} {
  return {
    code: payload?.error?.status || null,
    message: payload?.error?.message || null,
  };
}

async function fetchReviewsPage(args: {
  accessToken: string;
  locationResource: string;
  pageSize: number;
  pageToken?: string;
}): Promise<{ status: number; payload: GoogleReviewApiPayload | null }> {
  const endpoint = new URL(`https://mybusiness.googleapis.com/v4/${args.locationResource}/reviews`);
  endpoint.searchParams.set('pageSize', String(args.pageSize));
  if (args.pageToken) endpoint.searchParams.set('pageToken', args.pageToken);

  const response = await fetch(endpoint.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const text = await response.text();
  if (!text) return { status: response.status, payload: null };

  try {
    return { status: response.status, payload: JSON.parse(text) as GoogleReviewApiPayload };
  } catch {
    return { status: response.status, payload: null };
  }
}

export async function listGoogleReviews(args: {
  accessToken: string;
  locationResources: string[];
  pageSize?: number;
  maxPages?: number;
}): Promise<GoogleReviewsListResult> {
  const resources = Array.from(
    new Set(
      args.locationResources
        .map((entry) => compactWhitespace(entry))
        .filter((entry) => entry.length > 0),
    ),
  );

  if (resources.length === 0) {
    return {
      ok: false,
      httpStatus: 404,
      errorCode: 'location_missing',
      errorMessage: 'No s’ha pogut resoldre el location resource.',
      locationResource: null,
    };
  }

  const safePageSize = Math.max(1, Math.min(args.pageSize ?? 50, 50));
  const safeMaxPages = Math.max(1, Math.min(args.maxPages ?? 20, 20));
  let lastFailure: Omit<Extract<GoogleReviewsListResult, { ok: false }>, 'ok'> | null = null;

  for (const locationResource of resources) {
    const byId = new Map<string, GbpReviewSyncItem>();
    let pageToken: string | undefined;
    let pageCount = 0;
    let recoverable404 = false;

    while (pageCount < safeMaxPages) {
      pageCount += 1;
      const page = await fetchReviewsPage({
        accessToken: args.accessToken,
        locationResource,
        pageSize: safePageSize,
        pageToken,
      });

      if (page.status < 200 || page.status >= 300) {
        const mapped = mapError(page.payload);
        if (page.status === 404) {
          recoverable404 = true;
          lastFailure = {
            httpStatus: page.status,
            errorCode: mapped.code,
            errorMessage: mapped.message,
            locationResource,
          };
          break;
        }

        return {
          ok: false,
          httpStatus: page.status,
          errorCode: mapped.code,
          errorMessage: mapped.message,
          locationResource,
        };
      }

      const rows = Array.isArray(page.payload?.reviews) ? page.payload?.reviews || [] : [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const parsed = parseReview(row as Record<string, unknown>);
        if (!parsed) continue;
        byId.set(parsed.gbpReviewId, parsed);
      }

      const next = asString(page.payload?.nextPageToken);
      if (!next) break;
      pageToken = next;
    }

    if (recoverable404) {
      continue;
    }

    return {
      ok: true,
      reviews: Array.from(byId.values()),
      fetched: byId.size,
      locationResource,
    };
  }

  return {
    ok: false,
    httpStatus: lastFailure?.httpStatus ?? 404,
    errorCode: lastFailure?.errorCode ?? 'location_not_found',
    errorMessage: lastFailure?.errorMessage ?? 'No s’ha trobat cap local vàlid per llegir ressenyes.',
    locationResource: lastFailure?.locationResource ?? null,
  };
}

export async function refreshGoogleAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleRefreshAccessTokenResult> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleRefreshTokenPayload;
  if (!response.ok || !asString(payload.access_token)) {
    return {
      ok: false,
      httpStatus: response.status,
      errorCode: payload.error || null,
      errorMessage: payload.error_description || null,
    };
  }

  return {
    ok: true,
    accessToken: payload.access_token as string,
    refreshToken: asString(payload.refresh_token),
    expiresIn: typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? Math.max(0, Math.floor(payload.expires_in))
      : null,
  };
}
