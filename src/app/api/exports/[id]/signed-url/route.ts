export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireResourceAccessPatternB, ResourceTable } from '@/lib/api-handler';
import { createLogger, createRequestId } from '@/lib/logger';
import {
  validateParams,
  ExportParamsSchema,
} from '@/lib/validations';
import { exportStoragePathToObjectPath } from '@/lib/exports';
import type { ExportRecord } from '@/types/database';

type ExportSignedRow = Pick<ExportRecord,
  'id' | 'business_id' | 'storage_bucket' | 'storage_path' | 'status'>;

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/exports/[id]/signed-url' });

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

    const [routeParams, paramsErr] = validateParams(params, ExportParamsSchema);
    if (paramsErr) return withResponseRequestId(paramsErr);

    const access = await requireResourceAccessPatternB(
      request,
      routeParams.id,
      ResourceTable.Exports,
      { supabase, user },
    );
    if (access instanceof NextResponse) return withResponseRequestId(access);

    const { data: exportData, error: exportError } = await supabase
      .from('exports')
      .select('id, business_id, storage_bucket, storage_path, status')
      .eq('id', routeParams.id)
      .eq('business_id', access.bizId)
      .maybeSingle();

    if (exportError || !exportData) {
      return withResponseRequestId(NextResponse.json({ error: 'not_found', message: 'Export not found', request_id: requestId }, { status: 404 }));
    }

    const exportRow = exportData as ExportSignedRow;

    const objectPath = exportStoragePathToObjectPath(exportRow.storage_path, exportRow.storage_bucket);
    const { data: signedData, error: signedError } = await supabase.storage
      .from(exportRow.storage_bucket)
      .createSignedUrl(objectPath, 60 * 60 * 24);

    if (signedError || !signedData?.signedUrl) {
      log.error('Failed to create signed URL for export', {
        error: signedError?.message || 'unknown',
        export_id: exportRow.id,
      });
      return withResponseRequestId(
        NextResponse.json({ error: 'storage_error', message: 'Failed to create signed URL', request_id: requestId }, { status: 500 }),
      );
    }

    return withResponseRequestId(NextResponse.json({ signedUrl: signedData.signedUrl, request_id: requestId }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled export signed-url error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
