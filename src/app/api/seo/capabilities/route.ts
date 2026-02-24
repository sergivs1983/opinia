import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createLogger, createRequestId } from '@/lib/logger';

type ColumnProbeResult = {
  exists: boolean;
  error?: string;
};

async function probeBusinessColumn(args: {
  admin: ReturnType<typeof createAdminClient>;
  businessId: string;
  column: string;
}): Promise<ColumnProbeResult> {
  const { admin, businessId, column } = args;
  const { error } = await admin.from('businesses').select(`id, ${column}`).eq('id', businessId).limit(1);
  if (!error) return { exists: true };

  const message = String(error.message || '').toLowerCase();
  if (message.includes('column') && message.includes('does not exist')) {
    return { exists: false };
  }

  return {
    exists: false,
    error: error.message || 'unknown_probe_error',
  };
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/seo/capabilities' });

  const withRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const admin = createAdminClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withRequestId(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const businessId = request.headers.get('x-biz-id')?.trim();
    if (!businessId) {
      return withRequestId(
        NextResponse.json({ error: 'validation_error', message: 'Missing x-biz-id workspace header', request_id: requestId }, { status: 400 }),
      );
    }

    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .maybeSingle();

    if (businessError || !business) {
      return withRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }),
      );
    }

    const [seoEnabled, seoKeywords, seoAggressivity, seoAggressiveness] = await Promise.all([
      probeBusinessColumn({ admin, businessId, column: 'seo_enabled' }),
      probeBusinessColumn({ admin, businessId, column: 'seo_keywords' }),
      probeBusinessColumn({ admin, businessId, column: 'seo_aggressivity' }),
      probeBusinessColumn({ admin, businessId, column: 'seo_aggressiveness' }),
    ]);

    if (seoEnabled.error || seoKeywords.error || seoAggressivity.error || seoAggressiveness.error) {
      log.warn('SEO capabilities probe completed with non-schema probe errors', {
        business_id: businessId,
        seo_enabled_error: seoEnabled.error,
        seo_keywords_error: seoKeywords.error,
        seo_aggressivity_error: seoAggressivity.error,
        seo_aggressiveness_error: seoAggressiveness.error,
      });
    }

    const columns = {
      seo_enabled: seoEnabled.exists,
      seo_keywords: seoKeywords.exists,
      seo_aggressivity: seoAggressivity.exists,
      seo_aggressiveness: seoAggressiveness.exists,
    };

    const available = columns.seo_enabled && columns.seo_keywords && (columns.seo_aggressivity || columns.seo_aggressiveness);

    return withRequestId(
      NextResponse.json({
        available,
        columns,
        migration: available
          ? null
          : {
              files: ['supabase/phase-seo-keywords.sql', 'supabase/phase-j-seo-triggers.sql'],
              command: 'supabase db push',
              docs: '/docs/migration-v2.md',
            },
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    log.error('Unhandled SEO capabilities error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return withRequestId(
      NextResponse.json({ error: 'internal_error', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
    );
  }
}

