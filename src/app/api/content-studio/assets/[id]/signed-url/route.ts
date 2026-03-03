export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireResourceAccessPatternB, ResourceTable } from '@/lib/api-handler';
import { createLogger, createRequestId } from '@/lib/logger';
import {
  validateParams,
  ContentStudioAssetParamsSchema,
} from '@/lib/validations';
import { storagePathToObjectPath } from '@/lib/content-studio';
import type { ContentAsset } from '@/types/database';

type AssetSignedRow = Pick<ContentAsset,
  'id' | 'business_id' | 'storage_bucket' | 'storage_path' | 'status'>;

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/content-studio/assets/[id]/signed-url' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return withResponseRequestId(NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 }));
    }

    const [routeParams, paramsErr] = validateParams(params, ContentStudioAssetParamsSchema);
    if (paramsErr) return withResponseRequestId(paramsErr);

    const access = await requireResourceAccessPatternB(
      request,
      routeParams.id,
      ResourceTable.ContentAssets,
      { supabase, user },
    );
    if (access instanceof NextResponse) return withResponseRequestId(access);

    const { data: assetData, error: assetError } = await supabase
      .from('content_assets')
      .select('id, business_id, storage_bucket, storage_path, status')
      .eq('id', routeParams.id)
      .eq('business_id', access.bizId)
      .maybeSingle();

    if (assetError || !assetData) {
      return withResponseRequestId(NextResponse.json({ error: 'not_found', message: 'Asset not found' }, { status: 404 }));
    }

    const asset = assetData as AssetSignedRow;

    const objectPath = storagePathToObjectPath(asset.storage_path, asset.storage_bucket);
    const { data: signedData, error: signedError } = await supabase.storage
      .from(asset.storage_bucket)
      .createSignedUrl(objectPath, 60 * 60 * 24);

    if (signedError || !signedData?.signedUrl) {
      log.error('Failed to create signed URL for existing asset', {
        error: signedError?.message || 'unknown',
        asset_id: asset.id,
      });
      return withResponseRequestId(
        NextResponse.json({ error: 'storage_error', message: 'Failed to create signed URL', request_id: requestId }, { status: 500 }),
      );
    }

    return withResponseRequestId(NextResponse.json({ signedUrl: signedData.signedUrl, request_id: requestId }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled content asset signed-url error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
