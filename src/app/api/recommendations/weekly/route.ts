export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger, createRequestId } from '@/lib/logger';
import {
  ensureAndGetWeeklyRecommendations,
  getWeekStartMondayIso,
  mapBusinessTypeToVertical,
} from '@/lib/recommendations/d0';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateQuery } from '@/lib/validations';

const WeeklyRecommendationsQuerySchema = z.object({
  biz_id: z.string().uuid(),
});

type BusinessRow = {
  id: string;
  org_id: string;
  type: string | null;
};

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/recommendations/weekly' });

  const withHeaders = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  const [query, queryError] = validateQuery(request, WeeklyRecommendationsQuerySchema);
  if (queryError) return withHeaders(queryError);
  const payload = query as z.infer<typeof WeeklyRecommendationsQuerySchema>;

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
    });
    if (!access.allowed) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, org_id, type')
      .eq('id', payload.biz_id)
      .single();

    if (businessError || !businessData) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const business = businessData as BusinessRow;
    const weekStart = getWeekStartMondayIso(new Date());
    const vertical = mapBusinessTypeToVertical(business.type);
    const admin = createAdminClient();

    const { items } = await ensureAndGetWeeklyRecommendations({
      readClient: admin,
      writeClient: admin,
      bizId: business.id,
      orgId: business.org_id,
      vertical,
      weekStart,
    });

    return withHeaders(
      NextResponse.json({
        week_start: weekStart,
        items,
        request_id: requestId,
      }),
    );
  } catch (error) {
    log.error('Unhandled weekly recommendations error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withHeaders(
      NextResponse.json(
        { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
