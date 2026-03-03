export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { validateQuery } from '@/lib/validations';
import { requireBizAccessPatternB } from '@/lib/api-handler';

const GoogleStatusQuerySchema = z.object({
  biz_id: z.string().uuid(),
});

type GoogleState = 'connected' | 'needs_reauth' | 'not_connected';

type IntegrationRow = {
  id: string;
  is_active?: boolean | null;
  refresh_token?: string | null;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

const missingDependencyCodes = new Set(['PGRST204', 'PGRST205', '42P01', '42703', '42883']);

function hasMissingDependencyPattern(value: string): boolean {
  return (
    /schema cache/i.test(value) ||
    /column .* does not exist/i.test(value) ||
    /relation .* does not exist/i.test(value) ||
    /table .* does not exist/i.test(value) ||
    /function .* does not exist/i.test(value)
  );
}

function isMissingDependencyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as SupabaseErrorLike;
  if (err.code && missingDependencyCodes.has(err.code)) return true;
  const message = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.trim();
  return message.length > 0 && hasMissingDependencyPattern(message);
}

function hasToken(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveState(row: IntegrationRow | null, hasSecret: boolean): GoogleState {
  if (!row) return 'not_connected';
  if (row.is_active === true && (hasToken(row.refresh_token) || hasSecret)) return 'connected';
  return 'needs_reauth';
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/integrations/google/status' });

  const withHeaders = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withHeaders(
        NextResponse.json(
          { error: 'unauthorized', message: 'Auth required', request_id: requestId },
          { status: 401 },
        ),
      );
    }

    const [query, queryErr] = validateQuery(request, GoogleStatusQuerySchema);
    if (queryErr) return withHeaders(queryErr);
    const payload = query as z.infer<typeof GoogleStatusQuerySchema>;
    const gate = await requireBizAccessPatternB(request, payload.biz_id, {
      supabase,
      user,
      queryBizId: payload.biz_id,
    });
    if (gate instanceof NextResponse) return withHeaders(gate);

    if (gate.role !== 'owner' && gate.role !== 'manager' && gate.role !== 'staff') {
      return withHeaders(
        NextResponse.json(
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    const { data: integration, error } = await supabase
      .from('integrations')
      .select('id, is_active, refresh_token, updated_at')
      .eq('biz_id', gate.bizId)
      .eq('provider', 'google_business')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingDependencyError(error)) {
        log.warn('missing_dependency integrations status table/column', {
          error_code: error.code,
          error: error.message,
          business_id: gate.bizId,
        });
        return withHeaders(
          NextResponse.json({
            state: 'not_connected',
            provider: 'google_business',
            request_id: requestId,
          }),
        );
      }
      log.error('google status query failed', {
        error_code: error.code,
        error: error.message,
        business_id: gate.bizId,
      });
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    let hasSecret = false;
    if (integration?.id) {
      const { data: secretRow, error: secretError } = await supabase
        .from('integrations_secrets')
        .select('integration_id, updated_at')
        .eq('integration_id', integration.id)
        .limit(1)
        .maybeSingle();

      if (secretError) {
        if (isMissingDependencyError(secretError)) {
          log.warn('missing_dependency integrations_secrets table/column', {
            error_code: secretError.code,
            error: secretError.message,
            integration_id: integration.id,
          });
        } else {
          log.warn('google status secret presence check failed', {
            error_code: secretError.code,
            error: secretError.message,
            integration_id: integration.id,
          });
        }
      } else {
        hasSecret = !!secretRow?.integration_id;
      }
    }

    return withHeaders(
      NextResponse.json({
        state: resolveState((integration as IntegrationRow | null) ?? null, hasSecret),
        provider: 'google_business',
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    if (isMissingDependencyError(error)) {
      log.warn('missing_dependency google status fallback from exception', {
        error: error instanceof Error ? error.message : String(error),
      });
      return withHeaders(
        NextResponse.json({
          state: 'not_connected',
          provider: 'google_business',
          request_id: requestId,
        }),
      );
    }
    log.error('Unhandled google status error', {
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
