import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

/**
 * writeAudit — best-effort audit writer used by workers/endpoints.
 * Never throws (audit must not break prod flows).
 *
 * Prefers RPC log_audit_event if present; falls back to audit_log insert if permitted.
 */
export async function writeAudit(
  admin: SupabaseClient,
  payload: {
    action: string;
    biz_id?: string | null;
    org_id?: string | null;
    user_id?: string | null;
    details?: Record<string, unknown> | null;
  },
): Promise<void> {
  const log = createLogger({ route: 'audit-log' });

  // Prefer RPC (whitelisted/definer)
  try {
    const { error } = await admin.rpc('log_audit_event', {
      p_action: payload.action,
      p_biz_id: payload.biz_id,
      p_meta_json: payload.details ?? {},
    });
    if (!error) return;
  } catch (e) {
    log.warn('audit rpc threw; ignoring', { error: String(e) });
  }

  // Fallback: direct insert if table allows it for this role
  try {
    await admin.from('audit_log').insert([{
      action: payload.action,
      biz_id: payload.biz_id,
      org_id: payload.org_id,
      user_id: payload.user_id,
      details: payload.details ?? {},
    }]);
  } catch (e) {
    log.warn('audit insert failed; ignored', { error: String(e) });
  }
}
