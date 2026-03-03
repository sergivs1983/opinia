import type { SupabaseClient } from '@supabase/supabase-js';

import {
  listGoogleReviews,
  refreshGoogleAccessToken,
  type GbpReviewSyncItem,
} from '@/lib/integrations/google/reviews';
import type {
  NormalizedReview,
  ProviderSyncResult,
  ReviewsProvider,
  ReviewsProviderListParams,
} from '@/lib/providers/reviews-provider';
import { getOAuthTokens, saveOAuthTokens } from '@/lib/server/tokens';

const UPSERT_CHUNK_SIZE = 200;
const GBP_PROVIDER_STORAGE = 'google';
const MAX_ERROR_DETAIL_LENGTH = 300;

type ProviderLogger = {
  warn: (message: string, payload?: Record<string, unknown>) => void;
  error: (message: string, payload?: Record<string, unknown>) => void;
};

type BusinessRow = {
  id: string;
  org_id: string;
  google_location_name: string | null;
  google_location_id: string | null;
  google_account_id: string | null;
};

type IntegrationRow = {
  id: string;
  biz_id: string;
  account_id: string | null;
  is_active: boolean | null;
  consecutive_failures?: number | null;
};

type GbpReviewRow = {
  id: string;
  provider?: string | null;
  provider_review_id?: string | null;
  gbp_review_id?: string | null;
  rating?: number | null;
  star_rating?: number | null;
  text_snippet?: string | null;
  comment_preview?: string | null;
  author?: string | null;
  reviewer_label?: string | null;
  reply_status?: string | null;
  has_reply?: boolean | null;
  create_time: string;
  raw_ref?: unknown;
};

export class ReviewsProviderError extends Error {
  status: number;
  code: string;
  errorCode?: string;
  needsReauth: boolean;
  integrationId?: string;
  httpStatus?: number;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    errorCode?: string;
    needsReauth?: boolean;
    integrationId?: string;
    httpStatus?: number;
  }) {
    super(input.message);
    this.name = 'ReviewsProviderError';
    this.status = input.status;
    this.code = input.code;
    this.errorCode = input.errorCode;
    this.needsReauth = Boolean(input.needsReauth);
    this.integrationId = input.integrationId;
    this.httpStatus = input.httpStatus;
  }
}

type IntegrationHealthStatus = 'ok' | 'error' | 'needs_reauth';

export type IntegrationHealthUpdate = {
  status: IntegrationHealthStatus;
  errorCode?: string | null;
  errorDetail?: string | null;
  setNeedsReauth: boolean;
  incrementFailures: boolean;
};

type CreateGoogleReviewsProviderArgs = {
  supabase: SupabaseClient;
  log?: ProviderLogger;
};

function isSchemaCompatibilityError(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = (error?.message || '').toLowerCase();
  const code = (error?.code || '').toUpperCase();
  return code === '42703' || code === '42P10' || code === 'PGRST204'
    || message.includes('column')
    || message.includes('on conflict')
    || message.includes('constraint')
    || message.includes('schema cache');
}

function normalizeAccountName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('accounts/')) return trimmed;
  return `accounts/${trimmed}`;
}

function normalizeLocationName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('accounts/') && trimmed.includes('/locations/')) {
    const marker = trimmed.indexOf('/locations/');
    return trimmed.slice(marker + 1);
  }
  if (trimmed.startsWith('locations/')) return trimmed;
  if (/^\d+$/.test(trimmed)) return `locations/${trimmed}`;
  return null;
}

function buildLocationResources(input: {
  business: BusinessRow;
  integration: IntegrationRow;
}): string[] {
  const candidates = new Set<string>();

  const locationName = normalizeLocationName(input.business.google_location_name)
    || normalizeLocationName(input.business.google_location_id);
  const accountName = normalizeAccountName(input.business.google_account_id)
    || normalizeAccountName(input.integration.account_id);

  if (locationName && locationName.startsWith('accounts/')) {
    candidates.add(locationName);
  }
  if (accountName && locationName) {
    candidates.add(`${accountName}/${locationName}`);
  }
  if (locationName) {
    candidates.add(locationName);
  }

  return Array.from(candidates);
}

function isAuthFailure(input: { httpStatus: number; errorCode: string | null }): boolean {
  return input.httpStatus === 401
    || input.httpStatus === 403
    || input.errorCode === 'UNAUTHENTICATED'
    || input.errorCode === 'invalid_grant';
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCursorIso(cursor: string | null | undefined): string | null {
  if (!cursor) return null;
  const parsed = new Date(cursor);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeRawRef(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function toErrorDetail(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_ERROR_DETAIL_LENGTH);
}

function toSyncFailureCode(httpStatus: number, errorCode: string | null): string {
  if (httpStatus === 429) return 'rate_limited';
  if (errorCode && errorCode.trim().length > 0) return errorCode.trim();
  return `http_${httpStatus}`;
}

export function deriveFailureHealthUpdate(input: {
  httpStatus: number;
  errorCode: string | null;
  errorMessage: string | null;
}): IntegrationHealthUpdate {
  const authFailure = isAuthFailure({
    httpStatus: input.httpStatus,
    errorCode: input.errorCode,
  });

  if (authFailure) {
    return {
      status: 'needs_reauth',
      errorCode: input.errorCode || 'connector_auth_failed',
      errorDetail: toErrorDetail(input.errorMessage || 'Google authentication failed'),
      setNeedsReauth: true,
      incrementFailures: true,
    };
  }

  return {
    status: 'error',
    errorCode: toSyncFailureCode(input.httpStatus, input.errorCode),
    errorDetail: toErrorDetail(input.errorMessage),
    setNeedsReauth: false,
    incrementFailures: true,
  };
}

async function updateIntegrationHealth(args: {
  supabase: SupabaseClient;
  integrationId: string;
  update: IntegrationHealthUpdate;
}): Promise<void> {
  let nextFailures = 0;
  if (args.update.incrementFailures) {
    const { data: current, error: currentError } = await args.supabase
      .from('integrations')
      .select('consecutive_failures')
      .eq('id', args.integrationId)
      .maybeSingle();

    if (currentError) {
      if (isSchemaCompatibilityError(currentError)) {
        nextFailures = 1;
      } else {
        throw new Error(currentError.message || 'integration_health_lookup_failed');
      }
    } else {
      const currentFailures = typeof (current as { consecutive_failures?: number | null })?.consecutive_failures === 'number'
        ? Number((current as { consecutive_failures?: number | null }).consecutive_failures)
        : 0;
      nextFailures = Math.max(0, currentFailures) + 1;
    }
  }

  const payload = {
    last_sync_at: new Date().toISOString(),
    last_sync_status: args.update.status,
    last_error_code: args.update.errorCode || null,
    last_error_detail: args.update.errorDetail || null,
    needs_reauth: args.update.setNeedsReauth,
    consecutive_failures: args.update.incrementFailures ? nextFailures : 0,
    updated_at: new Date().toISOString(),
  };

  const { error } = await args.supabase
    .from('integrations')
    .update(payload)
    .eq('id', args.integrationId);

  if (error) {
    if (isSchemaCompatibilityError(error)) return;
    throw new Error(error.message || 'integration_health_update_failed');
  }
}

export function mapGbpReviewRowToNormalizedReview(row: GbpReviewRow): NormalizedReview {
  const rating = typeof row.rating === 'number'
    ? row.rating
    : (typeof row.star_rating === 'number' ? row.star_rating : 0);

  const providerReviewId = normalizeOptionalString(row.provider_review_id)
    || normalizeOptionalString(row.gbp_review_id)
    || row.id;

  const rawAuthor = normalizeOptionalString(row.author)
    || normalizeOptionalString(row.reviewer_label);

  const normalizedAuthor = rawAuthor && rawAuthor !== 'Un client' ? rawAuthor : null;

  const status = row.reply_status === 'replied' || row.reply_status === 'pending'
    ? row.reply_status
    : (row.has_reply ? 'replied' : 'pending');

  const text = normalizeOptionalString(row.text_snippet)
    || normalizeOptionalString(row.comment_preview)
    || null;

  return {
    id: row.id,
    provider: 'google_business',
    provider_review_id: providerReviewId,
    rating,
    text,
    created_at: row.create_time,
    reply_status: status,
    author_name: normalizedAuthor,
    raw_ref: normalizeRawRef(row.raw_ref),
  };
}

async function upsertReviews(args: {
  supabase: SupabaseClient;
  bizId: string;
  reviews: GbpReviewSyncItem[];
}): Promise<{ imported: number; updated: number; unchanged: number }> {
  if (args.reviews.length === 0) {
    return { imported: 0, updated: 0, unchanged: 0 };
  }

  let imported = 0;
  let updated = 0;

  for (let index = 0; index < args.reviews.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = args.reviews.slice(index, index + UPSERT_CHUNK_SIZE);
    const nowIso = new Date().toISOString();

    const providerIds = Array.from(new Set(
      chunk
        .map((review) => normalizeOptionalString(review.providerReviewId))
        .filter((value): value is string => Boolean(value)),
    ));

    let existingCount = 0;
    if (providerIds.length > 0) {
      const { data: existingRows, error: existingError } = await args.supabase
        .from('gbp_reviews')
        .select('provider_review_id')
        .eq('biz_id', args.bizId)
        .eq('provider', GBP_PROVIDER_STORAGE)
        .in('provider_review_id', providerIds);

      if (existingError && !isSchemaCompatibilityError(existingError)) {
        throw new Error(existingError.message || 'gbp_reviews_existing_lookup_failed');
      }

      if (!existingError) {
        existingCount = (existingRows || []).length;
      }
    }

    const rows = chunk.map((review) => ({
      biz_id: args.bizId,
      provider: GBP_PROVIDER_STORAGE,
      provider_review_id: review.providerReviewId,
      gbp_review_id: review.gbpReviewId,
      rating: review.rating,
      star_rating: review.starRating,
      text_snippet: review.textSnippet,
      comment_preview: review.commentPreview,
      author: review.author,
      reviewer_label: review.reviewerLabel,
      reply_status: review.replyStatus,
      raw_ref: review.rawRef,
      create_time: review.createTime,
      has_reply: review.hasReply,
      reply_time: review.replyTime,
      synced_at: nowIso,
      updated_at: nowIso,
    }));

    const { error } = await args.supabase
      .from('gbp_reviews')
      .upsert(rows, { onConflict: 'biz_id,provider,provider_review_id' });

    if (error) {
      if (!isSchemaCompatibilityError(error)) {
        throw new Error(error.message || 'gbp_reviews_upsert_failed');
      }

      const fallbackRows = chunk.map((review) => ({
        biz_id: args.bizId,
        gbp_review_id: review.gbpReviewId,
        star_rating: review.starRating,
        comment_preview: review.commentPreview,
        reviewer_label: review.reviewerLabel,
        create_time: review.createTime,
        has_reply: review.hasReply,
        reply_time: review.replyTime,
        synced_at: nowIso,
        updated_at: nowIso,
      }));

      const { error: fallbackError } = await args.supabase
        .from('gbp_reviews')
        .upsert(fallbackRows, { onConflict: 'gbp_review_id' });

      if (fallbackError) {
        throw new Error(fallbackError.message || 'gbp_reviews_upsert_failed');
      }

      imported += fallbackRows.length;
      continue;
    }

    updated += existingCount;
    imported += Math.max(0, rows.length - existingCount);
  }

  return {
    imported,
    updated,
    unchanged: 0,
  };
}

export function createGoogleReviewsProvider(args: CreateGoogleReviewsProviderArgs): ReviewsProvider {
  const supabase = args.supabase;

  return {
    async listReviews(
      bizId: string,
      params: ReviewsProviderListParams,
    ): Promise<{ items: NormalizedReview[]; next_cursor?: string }> {
      const safeLimit = Math.max(1, Math.min(params.limit, 100));
      const cursorIso = parseCursorIso(params.cursor);

      if (params.cursor && !cursorIso) {
        throw new ReviewsProviderError({
          status: 400,
          code: 'validation_error',
          message: 'cursor invàlid',
        });
      }

      const buildQuery = (selectColumns: string, filterByReplyStatus: boolean) => {
        let query = supabase
          .from('gbp_reviews')
          .select(selectColumns)
          .eq('biz_id', bizId)
          .order('create_time', { ascending: false })
          .limit(safeLimit + 1);

        if (params.status === 'pending') {
          query = filterByReplyStatus
            ? query.eq('reply_status', 'pending')
            : query.eq('has_reply', false);
        }

        if (params.status === 'replied') {
          query = filterByReplyStatus
            ? query.eq('reply_status', 'replied')
            : query.eq('has_reply', true);
        }

        if (cursorIso) {
          query = query.lt('create_time', cursorIso);
        }

        return query;
      };

      let { data, error } = await buildQuery(
        'id, provider, provider_review_id, gbp_review_id, rating, star_rating, text_snippet, comment_preview, author, reviewer_label, reply_status, has_reply, create_time, raw_ref',
        true,
      );

      if (error && isSchemaCompatibilityError(error)) {
        const fallback = await buildQuery(
          'id, gbp_review_id, star_rating, comment_preview, reviewer_label, has_reply, create_time',
          false,
        );
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        throw new ReviewsProviderError({
          status: 500,
          code: 'db_error',
          message: error.message || 'Failed to list reviews',
        });
      }

      const rows = (data || []) as unknown as GbpReviewRow[];
      const hasNext = rows.length > safeLimit;
      const sliced = hasNext ? rows.slice(0, safeLimit) : rows;
      const items = sliced.map(mapGbpReviewRowToNormalizedReview);
      const nextCursor = hasNext ? items[items.length - 1]?.created_at : undefined;

      return {
        items,
        next_cursor: nextCursor,
      };
    },

    async syncReviews(bizId: string): Promise<ProviderSyncResult> {
      const { data: businessData, error: businessError } = await supabase
        .from('businesses')
        .select('id, org_id, google_location_name, google_location_id, google_account_id')
        .eq('id', bizId)
        .eq('is_active', true)
        .maybeSingle();

      if (businessError || !businessData) {
        throw new ReviewsProviderError({
          status: 404,
          code: 'not_found',
          message: 'Business not found',
        });
      }

      const business = businessData as BusinessRow;
      const { data: integrationData, error: integrationError } = await supabase
        .from('integrations')
        .select('id, biz_id, account_id, is_active, consecutive_failures')
        .eq('biz_id', bizId)
        .eq('provider', 'google_business')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (integrationError) {
        throw new ReviewsProviderError({
          status: 500,
          code: 'internal',
          message: 'Integration lookup failed',
        });
      }

      if (!integrationData) {
        throw new ReviewsProviderError({
          status: 404,
          code: 'not_found',
          message: 'Google integration not found',
        });
      }

      const integration = integrationData as IntegrationRow;
      const locationResources = buildLocationResources({ business, integration });
      if (locationResources.length === 0) {
        await updateIntegrationHealth({
          supabase,
          integrationId: integration.id,
          update: {
            status: 'error',
            errorCode: 'missing_location',
            errorDetail: 'No s’ha pogut resoldre cap localització de Google per aquest negoci.',
            setNeedsReauth: false,
            incrementFailures: true,
          },
        });

        return {
          imported: 0,
          updated: 0,
          unchanged: 0,
          errors: 0,
          needs_reauth: false,
          skipped: 'missing_location',
          integration_id: integration.id,
          total_fetched: 0,
        };
      }

      let tokens: { accessToken: string; refreshToken: string | null };
      try {
        tokens = await getOAuthTokens(supabase, integration.id);
      } catch {
        await updateIntegrationHealth({
          supabase,
          integrationId: integration.id,
          update: {
            status: 'needs_reauth',
            errorCode: 'connector_auth_failed',
            errorDetail: 'Cal reconnectar Google per llegir noves ressenyes.',
            setNeedsReauth: true,
            incrementFailures: true,
          },
        });

        return {
          imported: 0,
          updated: 0,
          unchanged: 0,
          errors: 0,
          needs_reauth: true,
          skipped: 'needs_reauth',
          integration_id: integration.id,
          total_fetched: 0,
        };
      }

      let listed = await listGoogleReviews({
        accessToken: tokens.accessToken,
        locationResources,
        pageSize: 50,
        maxPages: 20,
      });

      if (!listed.ok && isAuthFailure({ httpStatus: listed.httpStatus, errorCode: listed.errorCode }) && tokens.refreshToken) {
        const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
        if (clientId && clientSecret) {
          const refreshed = await refreshGoogleAccessToken({
            refreshToken: tokens.refreshToken,
            clientId,
            clientSecret,
          });

          if (refreshed.ok) {
            const persistedRefreshToken = refreshed.refreshToken || tokens.refreshToken;
            await saveOAuthTokens(supabase, integration.id, refreshed.accessToken, persistedRefreshToken);
            listed = await listGoogleReviews({
              accessToken: refreshed.accessToken,
              locationResources,
              pageSize: 50,
              maxPages: 20,
            });
          }
        }
      }

      if (!listed.ok) {
        const healthUpdate = deriveFailureHealthUpdate({
          httpStatus: listed.httpStatus,
          errorCode: listed.errorCode,
          errorMessage: listed.errorMessage,
        });
        await updateIntegrationHealth({
          supabase,
          integrationId: integration.id,
          update: healthUpdate,
        });

        throw new ReviewsProviderError({
          status: 502,
          code: 'upstream_error',
          message: 'Google reviews sync failed',
          errorCode: healthUpdate.errorCode || undefined,
          needsReauth: healthUpdate.status === 'needs_reauth',
          integrationId: integration.id,
          httpStatus: listed.httpStatus,
        });
      }

      let counters: { imported: number; updated: number; unchanged: number };
      try {
        counters = await upsertReviews({
          supabase,
          bizId,
          reviews: listed.reviews,
        });
      } catch (error) {
        await updateIntegrationHealth({
          supabase,
          integrationId: integration.id,
          update: {
            status: 'error',
            errorCode: 'upsert_failed',
            errorDetail: toErrorDetail(error instanceof Error ? error.message : String(error)),
            setNeedsReauth: false,
            incrementFailures: true,
          },
        });
        throw error;
      }

      await updateIntegrationHealth({
        supabase,
        integrationId: integration.id,
        update: {
          status: 'ok',
          errorCode: null,
          errorDetail: null,
          setNeedsReauth: false,
          incrementFailures: false,
        },
      });

      return {
        imported: counters.imported,
        updated: counters.updated,
        unchanged: counters.unchanged,
        errors: 0,
        needs_reauth: false,
        integration_id: integration.id,
        location_resource: listed.locationResource,
        total_fetched: listed.fetched,
      };
    },
  };
}
