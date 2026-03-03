export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireResourceAccessPatternB, ResourceTable } from '@/lib/api-handler';
import { createLogger, createRequestId } from '@/lib/logger';
import {
  validateParams,
  BusinessBrandImageParamsSchema,
} from '@/lib/validations';
import { businessImageStoragePathToObjectPath } from '@/lib/business-images';
import type { Business } from '@/types/database';

type BusinessBrandImageSignedRow = Pick<
  Business,
  'id' | 'org_id' | 'brand_image_bucket' | 'brand_image_path' | 'brand_image_kind'
>;

function getSupabaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const rec = error as Record<string, unknown>;
  const code = rec.code || rec.statusCode || rec.status || rec.error;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : null;
}

function getSupabaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const rec = error as Record<string, unknown>;
  const message = rec.message;
  return typeof message === 'string' ? message : '';
}

function isMissingBrandImageSchema(error: unknown): boolean {
  return getSupabaseErrorCode(error) === '42703';
}

function isStorageObjectNotFound(error: unknown): boolean {
  const message = getSupabaseErrorMessage(error).toLowerCase();
  return message.includes('not found') || message.includes('object does not exist');
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/businesses/[id]/brand-image/signed-url' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  try {
    const [routeParams, paramsErr] = validateParams(params, BusinessBrandImageParamsSchema);
    if (paramsErr) return withResponseRequestId(paramsErr);

    const businessId = routeParams.id;
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('[brand-image-signed-url] unauthenticated', {
        businessId,
        hasUserId: false,
      });
      return withResponseRequestId(
        NextResponse.json({ error: 'unauthenticated', request_id: requestId }, { status: 401 }),
      );
    }

    const access = await requireResourceAccessPatternB(
      request,
      businessId,
      ResourceTable.Businesses,
      { supabase, user },
    );
    if (access instanceof NextResponse) {
      return withResponseRequestId(access);
    }

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, org_id, brand_image_bucket, brand_image_path, brand_image_kind')
      .eq('id', access.bizId)
      .maybeSingle();

    if (businessError) {
      const code = getSupabaseErrorCode(businessError);
      if (isMissingBrandImageSchema(businessError)) {
        console.warn('[brand-image-signed-url] brand image schema missing', {
          request_id: requestId,
          business_id: businessId,
          user_id: user.id,
          error_code: code,
        });
        log.warn('brand_image_schema_missing', {
          request_id: requestId,
          business_id: businessId,
          user_id: user.id,
          error_code: code,
          error: businessError.message,
        });
        return withResponseRequestId(
          NextResponse.json({
            ok: true,
            signedUrl: null,
            reason: 'brand_image_schema_missing',
            request_id: requestId,
          }),
        );
      }
      console.error('[brand-image-signed-url] business query failed', {
        businessId,
        hasUserId: true,
        userId: user.id,
        supabaseErrorCode: code,
      });
      log.error('Failed to load business for brand image signed URL', {
        business_id: businessId,
        user_id: user.id,
        error: businessError.message,
      });
      return withResponseRequestId(
        NextResponse.json({ error: 'internal', request_id: requestId }, { status: 500 }),
      );
    }

    if (!businessData) {
      console.error('[brand-image-signed-url] business not found', {
        businessId,
        hasUserId: true,
        userId: user.id,
      });
      return withResponseRequestId(
        NextResponse.json({ error: 'not_found', request_id: requestId }, { status: 404 }),
      );
    }

    const business = businessData as BusinessBrandImageSignedRow;
    if (!business.brand_image_path) {
      console.error('[brand-image-signed-url] image not found in business row', {
        businessId,
        hasUserId: true,
        userId: user.id,
      });
      return withResponseRequestId(
        NextResponse.json({ error: 'not_found', request_id: requestId }, { status: 404 }),
      );
    }

    const bucket = business.brand_image_bucket || 'business-images';
    const objectKey = businessImageStoragePathToObjectPath(business.brand_image_path, bucket);
    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectKey, 60 * 60 * 24);

    if (signedError || !signedData?.signedUrl) {
      const code = getSupabaseErrorCode(signedError);
      console.error('[brand-image-signed-url] sign failed', {
        businessId,
        hasUserId: true,
        userId: user.id,
        bucket,
        objectKey,
        supabaseErrorCode: code,
      });
      log.error('Failed to create business image signed URL', {
        business_id: business.id,
        user_id: user.id,
        bucket,
        object_key: objectKey,
        error: signedError?.message || 'unknown',
      });

      if (isStorageObjectNotFound(signedError)) {
        return withResponseRequestId(
          NextResponse.json({ error: 'not_found', request_id: requestId }, { status: 404 }),
        );
      }

      return withResponseRequestId(
        NextResponse.json({ error: 'internal', request_id: requestId }, { status: 500 }),
      );
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 24 * 1000).toISOString();
    return withResponseRequestId(
      NextResponse.json({
        url: signedData.signedUrl,
        signedUrl: signedData.signedUrl,
        expiresAt,
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    console.error('[brand-image-signed-url] unhandled error', {
      businessId: params?.id,
      hasUserId: null,
      supabaseErrorCode: getSupabaseErrorCode(error),
    });
    log.error('Unhandled business image signed-url error', { error: message });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
