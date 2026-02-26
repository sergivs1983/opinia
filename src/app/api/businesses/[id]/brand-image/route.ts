export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import {
  buildBusinessImageStoragePaths,
  validateBrandImageFile,
  type BrandImageMimeType,
} from '@/lib/business-images';
import {
  validateParams,
  BusinessBrandImageParamsSchema,
  BusinessBrandImageUploadSchema,
} from '@/lib/validations';
import type { Business } from '@/types/database';

interface BrandImageUploadBody {
  kind: 'logo' | 'cover';
}

type BusinessAccessRow = Pick<Business, 'id' | 'brand_image_bucket' | 'brand_image_path'>;
type BusinessBrandImageRow = Pick<Business, 'id' | 'brand_image_kind' | 'brand_image_path'>;

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/businesses/[id]/brand-image' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return withResponseRequestId(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const [routeParams, paramsErr] = validateParams(params, BusinessBrandImageParamsSchema);
    if (paramsErr) return withResponseRequestId(paramsErr);

    const workspaceBusinessId = request.headers.get('x-biz-id')?.trim();
    if (workspaceBusinessId && workspaceBusinessId !== routeParams.id) {
      return withResponseRequestId(
        NextResponse.json(
          { error: 'forbidden', message: 'businessId does not match current workspace', request_id: requestId },
          { status: 403 },
        ),
      );
    }

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, brand_image_bucket, brand_image_path')
      .eq('id', routeParams.id)
      .single();

    if (businessError || !businessData) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }),
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return withResponseRequestId(
        NextResponse.json(
          { error: 'validation_error', message: 'Invalid multipart form data', request_id: requestId },
          { status: 400 },
        ),
      );
    }

    const kindValue = formData.get('kind');
    const [body, bodyErr] = validateParams(
      {
        kind: typeof kindValue === 'string' ? kindValue : undefined,
      },
      BusinessBrandImageUploadSchema,
    );
    if (bodyErr) return withResponseRequestId(bodyErr);
    const payload = body as BrandImageUploadBody;

    const fileValue = formData.get('file');
    if (!(fileValue instanceof File)) {
      return withResponseRequestId(
        NextResponse.json(
          { error: 'validation_error', message: 'Missing image file (field "file")', request_id: requestId },
          { status: 400 },
        ),
      );
    }

    const fileValidation = validateBrandImageFile(fileValue);
    if (!fileValidation.ok) {
      const message = fileValidation.error === 'invalid_mime'
        ? 'Unsupported image type. Allowed: image/png, image/jpeg, image/webp.'
        : 'Image file too large. Maximum size is 4MB.';

      return withResponseRequestId(
        NextResponse.json(
          { error: 'validation_error', message, request_id: requestId },
          { status: 400 },
        ),
      );
    }

    const now = new Date();
    const { storageBucket, storagePath, objectPath } = buildBusinessImageStoragePaths({
      businessId: routeParams.id,
      kind: payload.kind,
      mimeType: fileValue.type as BrandImageMimeType,
      now,
    });

    const fileBuffer = Buffer.from(await fileValue.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(storageBucket)
      .upload(objectPath, fileBuffer, {
        contentType: fileValue.type,
        upsert: false,
      });

    if (uploadError) {
      log.error('Failed to upload business brand image', {
        business_id: routeParams.id,
        storage_path: storagePath,
        error: uploadError.message,
      });
      return withResponseRequestId(
        NextResponse.json(
          { error: 'storage_error', message: 'Failed to upload business image', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const existingBusiness = businessData as BusinessAccessRow;
    const oldStoragePath = existingBusiness.brand_image_path || null;
    const oldStorageBucket = existingBusiness.brand_image_bucket || storageBucket;

    const { data: updatedBusinessData, error: updateError } = await supabase
      .from('businesses')
      .update({
        brand_image_bucket: storageBucket,
        brand_image_path: storagePath,
        brand_image_kind: payload.kind,
        brand_image_updated_at: now.toISOString(),
      })
      .eq('id', routeParams.id)
      .select('id, brand_image_kind, brand_image_path')
      .single();

    if (updateError || !updatedBusinessData) {
      log.error('Failed to persist business brand image metadata', {
        business_id: routeParams.id,
        error: updateError?.message || 'unknown',
      });
      return withResponseRequestId(
        NextResponse.json(
          { error: 'db_error', message: 'Failed to persist business image metadata', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    if (oldStoragePath && oldStoragePath !== storagePath) {
      const oldObjectPath = oldStoragePath.startsWith(`${oldStorageBucket}/`)
        ? oldStoragePath.slice(`${oldStorageBucket}/`.length)
        : oldStoragePath;

      // Cleanup is best-effort; upload/update already succeeded.
      void supabase.storage
        .from(oldStorageBucket)
        .remove([oldObjectPath])
        .catch(() => {});
    }

    const updatedBusiness = updatedBusinessData as BusinessBrandImageRow;
    return withResponseRequestId(
      NextResponse.json({
        brandImage: {
          kind: updatedBusiness.brand_image_kind || payload.kind,
          path: updatedBusiness.brand_image_path || storagePath,
        },
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled business brand image upload error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
