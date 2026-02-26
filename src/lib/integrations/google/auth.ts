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

/**
 * getValidGoogleAccessToken(admin, bizId)
 * Compatibility shim for the worker.
 * Finds the active google integration for a business and returns decrypted tokens.
 */
export async function getValidGoogleAccessToken(
  admin: SupabaseClient,
  bizId: string,
): Promise<{ accessToken: string; refreshToken: string | null; integrationId: string }> {
  // Prefer provider name used in worker checks
  const { data: integ, error } = await admin
    .from('integrations')
    .select('id,biz_id,provider,status')
    .eq('biz_id', bizId)
    .in('provider', ['google_business', 'google'])
    .neq('status', 'disconnected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !integ) throw new GoogleAuthError('Integration not found', 'connector_auth_failed');

  const integration = integ as IntegrationRow;

  if (integration.status === 'needs_reauth') throw new GoogleAuthError('Integration needs reauth', 'connector_auth_failed');

  const tokens = await getOAuthTokens(admin, integration.id);
  if (!tokens?.accessToken) throw new GoogleAuthError('Missing access token', 'connector_auth_failed');

  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, integrationId: integration.id };
}
