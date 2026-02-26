import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptAESGCM } from '@/lib/crypto';

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
  access_token_encrypted?: string | null;
  expires_at?: string | null;
};

export async function getValidGoogleAccessToken(args: {
  admin: SupabaseClient;
  integrationId: string;
  bizId: string;
}): Promise<string> {
  const { admin, integrationId, bizId } = args;

  const { data, error } = await admin
    .from('integrations')
    .select('id,biz_id,provider,status,access_token_encrypted,expires_at')
    .eq('id', integrationId)
    .maybeSingle();

  if (error || !data) throw new GoogleAuthError('Integration not found');

  const row = data as IntegrationRow;

  if (row.biz_id !== bizId) throw new GoogleAuthError('Integration ownership mismatch', 'internal_job_failed');

  // Accept either naming; Flow B will normalize this
  if (row.provider !== 'google_business' && row.provider !== 'google') {
    throw new GoogleAuthError('Integration provider mismatch', 'internal_job_failed');
  }

  if (row.status === 'needs_reauth') throw new GoogleAuthError('Integration needs reauth');

  if (!row.access_token_encrypted) throw new GoogleAuthError('Missing access token');

  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new GoogleAuthError('Missing ENCRYPTION_KEY env', 'internal_job_failed');

  try {
    // NOTE: Flow B will add refresh + locks. For now, just decrypt and return.
    return decryptAESGCM(row.access_token_encrypted, key);
  } catch {
    throw new GoogleAuthError('Token decrypt failed', 'internal_job_failed');
  }
}
