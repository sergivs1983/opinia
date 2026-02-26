import type { SupabaseClient } from '@supabase/supabase-js';
import { getOAuthTokens } from '@/lib/server/tokens';

export class GoogleAuthError extends Error {
  code: string;
  constructor(message: string, code = 'connector_auth_failed') {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
  }
}

type IntegrationRow = {
  id: string;
  biz_id: string;
  provider: string;
  status?: string | null;
};

export async function getValidGoogleAccessToken(args: {
  admin: SupabaseClient;
  integrationId: string;
  bizId: string;
}): Promise<string> {
  const { admin, integrationId, bizId } = args;

  const { data: integ, error: integErr } = await admin
    .from('integrations')
    .select('id,biz_id,provider,status')
    .eq('id', integrationId)
    .maybeSingle();

  if (integErr || !integ) throw new GoogleAuthError('Integration not found');

  const integration = integ as IntegrationRow;

  if (integration.biz_id !== bizId) {
    throw new GoogleAuthError('Integration ownership mismatch', 'internal_job_failed');
  }

  if (integration.provider !== 'google_business' && integration.provider !== 'google') {
    throw new GoogleAuthError('Integration provider mismatch', 'internal_job_failed');
  }

  if (integration.status === 'needs_reauth') {
    throw new GoogleAuthError('Integration needs reauth', 'connector_auth_failed');
  }

  try {
    const { accessToken } = await getOAuthTokens(admin, integrationId);
    if (!accessToken) throw new Error('missing');
    return accessToken;
  } catch {
    throw new GoogleAuthError('Token read/decrypt failed', 'internal_job_failed');
  }
}
