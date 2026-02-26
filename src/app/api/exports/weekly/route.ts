export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { dispatchEvent } from '@/lib/integrations';
import { bumpDailyMetric } from '@/lib/metrics';
import { normalizeWeekStartMonday } from '@/lib/planner';
import {
  validateBody,
  ExportWeeklyBodySchema,
} from '@/lib/validations';
import {
  buildExportStoragePaths,
  buildManifestJson,
  buildWeeklyZip,
  exportStoragePathToObjectPath,
  resolveExportLanguage,
  type ExportBusinessRow,
  type WeeklyExportAssetFile,
  type WeeklyExportItem,
} from '@/lib/exports';
import type {
  ContentPlannerChannel,
  ContentPlannerItemType,
  ContentPlannerStatus,
  ExportLanguage,
} from '@/types/database';

interface WeeklyExportBody {
  weekStart: string;
  language?: ExportLanguage;
  includeAssets: boolean;
  includeTexts: boolean;
  includeCsv: boolean;
  includeReadme: boolean;
  debug: boolean;
}

type PlannerItemRow = {
  id: string;
  scheduled_at: string;
  channel: ContentPlannerChannel;
  item_type: ContentPlannerItemType;
  suggestion_id: string | null;
  asset_id: string | null;
  text_post_id: string | null;
  title: string;
  status: ContentPlannerStatus;
};

type SuggestionRow = {
  id: string;
  title: string | null;
  caption: string | null;
  cta: string | null;
};

type AssetRow = {
  id: string;
  suggestion_id: string | null;
  format: 'story' | 'feed';
  template_id: string;
  storage_bucket: string;
  storage_path: string;
};

type TextPostRow = {
  id: string;
  variants: unknown;
};

type ExistingExportRow = {
  id: string;
  storage_bucket: string;
  storage_path: string;
};

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function assetFileName(asset: AssetRow): string {
  return `${asset.id}_${asset.format}_${asset.template_id}.png`;
}

async function ensureBusinessAccess(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  businessId: string,
): Promise<boolean> {
  const { data: businessAccess, error: businessAccessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .single();

  return !businessAccessError && !!businessAccess;
}

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/exports/weekly' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return withResponseRequestId(NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }));
    }

    const [body, bodyErr] = await validateBody(request, ExportWeeklyBodySchema);
    if (bodyErr) return withResponseRequestId(bodyErr);
    const payload = body as WeeklyExportBody;

    const businessId = request.headers.get('x-biz-id')?.trim();
    if (!businessId) {
      return withResponseRequestId(
        NextResponse.json({ error: 'validation_error', message: 'Missing x-biz-id workspace header', request_id: requestId }, { status: 400 }),
      );
    }

    const hasAccess = await ensureBusinessAccess(supabase, businessId);
    if (!hasAccess) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }),
      );
    }

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, org_id, default_language')
      .eq('id', businessId)
      .single();

    if (businessError || !businessData) {
      return withResponseRequestId(NextResponse.json({ error: 'not_found', message: 'Business not found', request_id: requestId }, { status: 404 }));
    }

    const business = businessData as ExportBusinessRow;

    const { data: profileData } = await supabase
      .from('profiles')
      .select('locale')
      .eq('id', user.id)
      .maybeSingle();
    const profileLocale = (profileData as { locale?: string | null } | null)?.locale || null;

    const { data: orgData } = await supabase
      .from('organizations')
      .select('locale')
      .eq('id', business.org_id)
      .maybeSingle();
    const orgLocale = (orgData as { locale?: string | null } | null)?.locale || profileLocale;

    const language = resolveExportLanguage({
      requestedLanguage: payload.language,
      business,
      orgLocale,
    });

    const weekStart = normalizeWeekStartMonday(payload.weekStart);

    const { data: plannerData, error: plannerError } = await supabase
      .from('content_planner_items')
      .select('id, scheduled_at, channel, item_type, suggestion_id, asset_id, text_post_id, title, status')
      .eq('business_id', businessId)
      .eq('week_start', weekStart)
      .order('scheduled_at', { ascending: true })
      .limit(500);

    if (plannerError) {
      log.error('Failed to load planner items for export', { error: plannerError.message, business_id: businessId });
      return withResponseRequestId(
        NextResponse.json({ error: 'db_error', message: 'Failed to load planner items', request_id: requestId }, { status: 500 }),
      );
    }

    const plannerItems = (plannerData || []) as PlannerItemRow[];
    const directSuggestionIds = plannerItems
      .map((item) => item.suggestion_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    const assetIds = plannerItems
      .map((item) => item.asset_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    const textPostIds = plannerItems
      .map((item) => item.text_post_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    let assets: AssetRow[] = [];
    if (assetIds.length > 0) {
      const { data: assetsData, error: assetsError } = await supabase
        .from('content_assets')
        .select('id, suggestion_id, format, template_id, storage_bucket, storage_path')
        .in('id', dedupe(assetIds))
        .eq('business_id', businessId);

      if (assetsError) {
        log.error('Failed to load linked assets for export', { error: assetsError.message, business_id: businessId });
        return withResponseRequestId(
          NextResponse.json({ error: 'db_error', message: 'Failed to load linked assets', request_id: requestId }, { status: 500 }),
        );
      }

      assets = (assetsData || []) as AssetRow[];
    }

    let textPosts: TextPostRow[] = [];
    if (textPostIds.length > 0) {
      const { data: textPostsData, error: textPostsError } = await supabase
        .from('content_text_posts')
        .select('id, variants')
        .in('id', dedupe(textPostIds))
        .eq('business_id', businessId);

      if (textPostsError) {
        log.error('Failed to load linked text posts for export', { error: textPostsError.message, business_id: businessId });
        return withResponseRequestId(
          NextResponse.json({ error: 'db_error', message: 'Failed to load linked text posts', request_id: requestId }, { status: 500 }),
        );
      }

      textPosts = (textPostsData || []) as TextPostRow[];
    }

    const suggestionIdsFromAssets = assets
      .map((asset) => asset.suggestion_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const suggestionIds = dedupe([...directSuggestionIds, ...suggestionIdsFromAssets]);

    let suggestions: SuggestionRow[] = [];
    if (suggestionIds.length > 0) {
      const { data: suggestionsData, error: suggestionsError } = await supabase
        .from('content_suggestions')
        .select('id, title, caption, cta')
        .in('id', suggestionIds)
        .eq('business_id', businessId);

      if (suggestionsError) {
        log.error('Failed to load linked suggestions for export', { error: suggestionsError.message, business_id: businessId });
        return withResponseRequestId(
          NextResponse.json({ error: 'db_error', message: 'Failed to load linked suggestions', request_id: requestId }, { status: 500 }),
        );
      }

      suggestions = (suggestionsData || []) as SuggestionRow[];
    }

    const suggestionsById = new Map(suggestions.map((row) => [row.id, row]));
    const assetsById = new Map(assets.map((row) => [row.id, row]));
    const textPostsById = new Map(textPosts.map((row) => [row.id, row]));

    const items: WeeklyExportItem[] = plannerItems.map((plannerItem) => {
      const linkedAsset = plannerItem.asset_id ? assetsById.get(plannerItem.asset_id) : undefined;
      const linkedSuggestionId = plannerItem.suggestion_id || linkedAsset?.suggestion_id || null;
      const linkedSuggestion = linkedSuggestionId ? suggestionsById.get(linkedSuggestionId) : undefined;
      const linkedTextPost = plannerItem.text_post_id ? textPostsById.get(plannerItem.text_post_id) : undefined;

      const variants = asTextArray(linkedTextPost?.variants);
      const caption = linkedSuggestion?.caption?.trim()
        || variants[0]
        || '';
      const cta = linkedSuggestion?.cta?.trim() || '';

      return {
        id: plannerItem.id,
        scheduled_at: plannerItem.scheduled_at,
        channel: plannerItem.channel,
        title: plannerItem.title || linkedSuggestion?.title?.trim() || 'Planner item',
        caption,
        cta,
        status: plannerItem.status,
        asset_filename: linkedAsset ? assetFileName(linkedAsset) : '',
      };
    });

    const includeAssets = payload.includeAssets;
    const assetFiles: WeeklyExportAssetFile[] = [];
    if (includeAssets) {
      const usedAssetIds = dedupe(
        plannerItems
          .map((item) => item.asset_id)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      );

      for (const assetId of usedAssetIds) {
        const asset = assetsById.get(assetId);
        if (!asset) continue;

        const objectPath = exportStoragePathToObjectPath(asset.storage_path, asset.storage_bucket);
        const { data: assetBlob, error: assetError } = await supabase.storage
          .from(asset.storage_bucket)
          .download(objectPath);

        if (assetError || !assetBlob) {
          log.warn('Skipping asset in export zip due to download error', {
            error: assetError?.message || 'unknown',
            asset_id: asset.id,
            storage_path: asset.storage_path,
          });
          continue;
        }

        const fileBuffer = Buffer.from(await assetBlob.arrayBuffer());
        assetFiles.push({
          filename: assetFileName(asset),
          data: fileBuffer,
        });
      }
    }

    const manifest = {
      week_start: weekStart,
      language,
      items_count: items.length,
      generated_at: new Date().toISOString(),
      request_id: requestId,
    };

    const zipBundle = buildWeeklyZip({
      manifest,
      items,
      includeCsv: payload.includeCsv,
      includeTexts: payload.includeTexts,
      includeReadme: payload.includeReadme,
      assetFiles,
    });

    const { data: existingExportData, error: existingExportError } = await supabase
      .from('exports')
      .select('id, storage_bucket, storage_path')
      .eq('business_id', businessId)
      .eq('week_start', weekStart)
      .eq('language', language)
      .eq('kind', 'weekly_pack')
      .maybeSingle();

    if (existingExportError) {
      log.error('Failed to check existing weekly export', { error: existingExportError.message, business_id: businessId });
      return withResponseRequestId(
        NextResponse.json({ error: 'db_error', message: 'Failed to prepare export', request_id: requestId }, { status: 500 }),
      );
    }

    const existingExport = existingExportData as ExistingExportRow | null;
    const exportId = existingExport?.id || randomUUID();

    const { storageBucket, storagePath, objectPath } = buildExportStoragePaths({
      businessId,
      exportId,
      weekStart,
      language,
    });

    const { error: uploadError } = await supabase.storage
      .from(storageBucket)
      .upload(objectPath, zipBundle.zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      log.error('Failed to upload weekly export zip', { error: uploadError.message, storage_path: storagePath, business_id: businessId });
      return withResponseRequestId(
        NextResponse.json({ error: 'storage_error', message: 'Failed to store weekly export', request_id: requestId }, { status: 500 }),
      );
    }

    const exportRowPayload = {
      business_id: businessId,
      week_start: weekStart,
      language,
      kind: 'weekly_pack',
      storage_bucket: storageBucket,
      storage_path: storagePath,
      bytes: zipBundle.zipBuffer.byteLength,
      items_count: items.length,
      status: 'ready',
      created_at: new Date().toISOString(),
    };

    if (existingExport) {
      const { error: updateExportError } = await supabase
        .from('exports')
        .update(exportRowPayload)
        .eq('id', existingExport.id);

      if (updateExportError) {
        log.error('Failed to update weekly export row', { error: updateExportError.message, export_id: existingExport.id });
        return withResponseRequestId(
          NextResponse.json({ error: 'db_error', message: 'Failed to persist export row', request_id: requestId }, { status: 500 }),
        );
      }
    } else {
      const { error: insertExportError } = await supabase
        .from('exports')
        .insert({
          id: exportId,
          ...exportRowPayload,
        });

      if (insertExportError) {
        log.error('Failed to insert weekly export row', { error: insertExportError.message, export_id: exportId });
        return withResponseRequestId(
          NextResponse.json({ error: 'db_error', message: 'Failed to persist export row', request_id: requestId }, { status: 500 }),
        );
      }
    }

    await bumpDailyMetric(
      businessId,
      new Date().toISOString().slice(0, 10),
      { exports_created: 1 },
      { admin: supabase, log },
    );

    void dispatchEvent({
      businessId,
      event: 'export.created',
      admin: supabase,
      data: {
        export_id: exportId,
        week_start: weekStart,
        language,
        bytes: zipBundle.zipBuffer.byteLength,
        items_count: items.length,
      },
      requestId,
      userId: user.id,
      log: log.child({ hook: 'export.created' }),
    }).catch((dispatchError: unknown) => {
      log.warn('export.created integration dispatch failed (non-blocking)', {
        export_id: exportId,
        error: dispatchError instanceof Error ? dispatchError.message : 'unknown',
      });
    });

    const { data: signedData, error: signedError } = await supabase.storage
      .from(storageBucket)
      .createSignedUrl(objectPath, 60 * 60 * 24);

    if (signedError || !signedData?.signedUrl) {
      log.error('Failed to create signed URL for weekly export', { error: signedError?.message || 'unknown', export_id: exportId });
      return withResponseRequestId(
        NextResponse.json({ error: 'storage_error', message: 'Failed to create signed URL', request_id: requestId }, { status: 500 }),
      );
    }

    return withResponseRequestId(
      NextResponse.json({
        exportId,
        weekStart,
        language,
        signedUrl: signedData.signedUrl,
        bytes: zipBundle.zipBuffer.byteLength,
        itemsCount: items.length,
        request_id: requestId,
        ...(payload.debug ? {
          manifest: buildManifestJson(manifest),
          entries: zipBundle.entries,
        } : {}),
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled weekly export error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
