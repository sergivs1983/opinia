export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createLogger, createRequestId } from '@/lib/logger';
import { dispatchEvent } from '@/lib/integrations';
import { bumpDailyMetric } from '@/lib/metrics';
import {
  validateBody,
  ContentStudioRenderSchema,
} from '@/lib/validations';
import {
  buildStoragePaths,
  buildStudioRenderPayload,
  buildStudioRenderPayloadFromStored,
  payloadToJson,
  resolveStudioLanguage,
  resolveTemplateId,
  type StudioBrandOverride,
  type StudioFormat,
  type StudioLanguage,
  type StudioTemplateId,
} from '@/lib/content-studio';
import { renderStudioWithEngine, type RenderEngine } from '@/lib/render';
import type { Business, ContentAsset, ContentSuggestion } from '@/types/database';
import type { JsonValue } from '@/types/json';
import { rateLimitAI, checkDailyAIQuota } from '@/lib/security/ratelimit';

interface RenderBody {
  suggestionId?: string;
  sourceAssetId?: string;
  format: StudioFormat;
  templateId: StudioTemplateId;
  language?: StudioLanguage;
  debugBase64: boolean;
  brand?: StudioBrandOverride;
}

type SuggestionRenderRow = Pick<ContentSuggestion,
  'id' | 'business_id' | 'language' | 'title' | 'hook' | 'caption' |
  'cta' | 'best_time' | 'shot_list' | 'hashtags' | 'evidence'>;

type BusinessRenderRow = Pick<Business, 'id' | 'name' | 'default_language'>;

type StoredAssetRow = Pick<ContentAsset,
  'id' | 'business_id' | 'suggestion_id' | 'language' | 'payload'>;

interface AssetInsertRow {
  id: string;
}

function payloadLanguage(payload: JsonValue | null): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const language = (payload as { language?: unknown }).language;
  return typeof language === 'string' ? language : undefined;
}

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/content-studio/render' });
  const includeRenderEngineHeader = process.env.NODE_ENV === 'test' || process.env.E2E === '1';

  const withResponseRequestId = (response: NextResponse, renderEngine?: RenderEngine) => {
    response.headers.set('x-request-id', requestId);
    if (includeRenderEngineHeader && renderEngine) {
      response.headers.set('x-render-engine', renderEngine);
    }
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return withResponseRequestId(NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 }));
    }

    const [body, bodyErr] = await validateBody(request, ContentStudioRenderSchema);
    if (bodyErr) return withResponseRequestId(bodyErr);

    const payload = body as RenderBody;
    const workspaceBusinessId = request.headers.get('x-biz-id')?.trim();

    let suggestion: SuggestionRenderRow | null = null;
    let businessId: string | null = null;
    let sourceSuggestionId: string | null = null;
    let sourceStoredPayload: JsonValue | null = null;

    if (payload.suggestionId) {
      const { data: suggestionData, error: suggestionError } = await supabase
        .from('content_suggestions')
        .select('id, business_id, language, title, hook, caption, cta, best_time, shot_list, hashtags, evidence')
        .eq('id', payload.suggestionId)
        .single();

      if (suggestionError || !suggestionData) {
        return withResponseRequestId(NextResponse.json({ error: 'not_found', message: 'Suggestion not found' }, { status: 404 }));
      }

      suggestion = suggestionData as SuggestionRenderRow;
      sourceSuggestionId = suggestion.id;
      businessId = suggestion.business_id;
    } else if (payload.sourceAssetId) {
      const { data: sourceAssetData, error: sourceAssetError } = await supabase
        .from('content_assets')
        .select('id, business_id, suggestion_id, language, payload')
        .eq('id', payload.sourceAssetId)
        .single();

      if (sourceAssetError || !sourceAssetData) {
        return withResponseRequestId(NextResponse.json({ error: 'not_found', message: 'Source asset not found' }, { status: 404 }));
      }

      const sourceAsset = sourceAssetData as StoredAssetRow;
      businessId = sourceAsset.business_id;
      sourceSuggestionId = sourceAsset.suggestion_id || null;
      sourceStoredPayload = sourceAsset.payload;

      if (sourceSuggestionId) {
        const { data: suggestionData } = await supabase
          .from('content_suggestions')
          .select('id, business_id, language, title, hook, caption, cta, best_time, shot_list, hashtags, evidence')
          .eq('id', sourceSuggestionId)
          .maybeSingle();

        if (suggestionData) {
          suggestion = suggestionData as SuggestionRenderRow;
        }
      }
    }

    if (!businessId) {
      return withResponseRequestId(NextResponse.json({ error: 'bad_request', message: 'Missing render source' }, { status: 400 }));
    }

    if (workspaceBusinessId && workspaceBusinessId !== businessId) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'Asset source does not belong to current workspace' }, { status: 403 }),
      );
    }

    // ── Bloc 8: Rate limit + AI daily quota ──
    const rlKey = `${businessId}:${user.id}`;
    const rl = await rateLimitAI(rlKey);
    if (!rl.ok) return withResponseRequestId(rl.res);
    const quota = await checkDailyAIQuota(businessId, 'free');
    if (!quota.ok) return withResponseRequestId(quota.res);

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, name, default_language')
      .eq('id', businessId)
      .single();

    if (businessError || !businessData) {
      return withResponseRequestId(NextResponse.json({ error: 'forbidden', message: 'No access to this business' }, { status: 403 }));
    }

    const business = businessData as BusinessRenderRow;
    const language = resolveStudioLanguage({
      requestedLanguage: payload.language,
      suggestionLanguage: suggestion?.language || payloadLanguage(sourceStoredPayload),
      businessLanguage: business.default_language,
    });

    const templateId = resolveTemplateId(payload.templateId);

    const renderPayload = suggestion
      ? buildStudioRenderPayload({
          suggestion,
          business,
          language,
          format: payload.format,
          templateId,
          brand: payload.brand,
        })
      : buildStudioRenderPayloadFromStored({
          storedPayload: sourceStoredPayload,
          businessName: business.name,
          language,
          format: payload.format,
          templateId,
          brand: payload.brand,
        });

    const renderResult = await renderStudioWithEngine(renderPayload);

    const assetId = randomUUID();
    const { storageBucket, storagePath, objectPath } = buildStoragePaths({
      businessId: business.id,
      assetId,
      format: payload.format,
      templateId,
    });

    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage
      .from(storageBucket)
      .upload(objectPath, renderResult.pngBuffer, {
        contentType: 'image/png',
        upsert: false,
      });

    if (uploadError) {
      log.error('Failed to upload content asset PNG', { error: uploadError.message, object_path: objectPath });

      await supabase
        .from('content_assets')
        .insert({
          id: assetId,
          business_id: business.id,
          suggestion_id: sourceSuggestionId,
          language,
          format: payload.format,
          template_id: templateId,
          status: 'failed',
          storage_bucket: storageBucket,
          storage_path: storagePath,
          width: renderResult.width,
          height: renderResult.height,
          bytes: renderResult.pngBuffer.byteLength,
          payload: payloadToJson(renderPayload),
        });

      return withResponseRequestId(
        NextResponse.json(
          { error: 'storage_error', message: 'Failed to store generated PNG', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const { data: assetData, error: assetError } = await supabase
      .from('content_assets')
      .insert({
        id: assetId,
        business_id: business.id,
        suggestion_id: sourceSuggestionId,
        language,
        format: payload.format,
        template_id: templateId,
        status: 'created',
        storage_bucket: storageBucket,
        storage_path: storagePath,
        width: renderResult.width,
        height: renderResult.height,
        bytes: renderResult.pngBuffer.byteLength,
        payload: payloadToJson(renderPayload),
      })
      .select('id')
      .single();

    if (assetError || !assetData) {
      log.error('Failed to persist studio asset metadata', { error: assetError?.message || 'unknown' });
      return withResponseRequestId(
        NextResponse.json(
          { error: 'db_error', message: 'Failed to persist content asset', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    await bumpDailyMetric(
      business.id,
      new Date().toISOString().slice(0, 10),
      { assets_created: 1 },
      { admin, log },
    );

    const { data: signedData, error: signedError } = await admin.storage
      .from(storageBucket)
      .createSignedUrl(objectPath, 60 * 60 * 24);

    if (signedError || !signedData?.signedUrl) {
      log.error('Failed to create signed URL for asset', { error: signedError?.message || 'unknown', object_path: objectPath });
      return withResponseRequestId(
        NextResponse.json(
          { error: 'storage_error', message: 'Failed to create signed URL', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const savedAsset = assetData as AssetInsertRow;
    void dispatchEvent({
      businessId: business.id,
      event: 'asset.created',
      data: {
        asset_id: savedAsset.id,
        suggestion_id: sourceSuggestionId,
        format: payload.format,
        template_id: templateId,
        storage_path: storagePath,
      },
      requestId,
      userId: user.id,
      log: log.child({ hook: 'asset.created' }),
    }).catch((dispatchError: unknown) => {
      log.warn('asset.created integration dispatch failed (non-blocking)', {
        asset_id: savedAsset.id,
        error: dispatchError instanceof Error ? dispatchError.message : 'unknown',
      });
    });

    return withResponseRequestId(
      NextResponse.json({
        assetId: savedAsset.id,
        format: payload.format,
        templateId,
        signedUrl: signedData.signedUrl,
        ...(payload.debugBase64 ? { pngBase64: renderResult.pngBase64 } : {}),
        request_id: requestId,
      }),
      renderResult.engine,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled content studio render error', { error: message });

    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
