import { createAdminClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

type AuditPayload = {
  action: string;
  bizId?: string | null;
  orgId?: string | null;
  requestId?: string | null;
  userId?: string | null;
  details?: Record<string, unknown> | null;
  // allow extra fields like: resource, result, etc.
  [k: string]: unknown;
};

/**
 * writeAudit — best-effort audit writer (single-arg).
 * Accepts extra metadata fields; never throws.
 */
export async function writeAudit(payload: AuditPayload): Promise<void> {
  const log = createLogger({ route: 'audit-log', request_id: (payload.requestId as string | undefined) });

  // Pull known fields; push the rest into meta
  const {
    action,
    bizId = null,
    orgId = null,
    requestId = null,
    userId = null,
    details = null,
    ...rest
  } = payload;

  const meta = {
    request_id: requestId,
    org_id: orgId,
    user_id: userId,
    ...(rest ?? {}),
    ...(details ?? {}),
  };

  try {
    const admin = createAdminClient();

    // Prefer RPC if present
    const { error: rpcErr } = await admin.rpc('log_audit_event', {
      p_action: action,
      p_biz_id: bizId,
      p_meta_json: meta,
    });

    if (!rpcErr) return;

    // Fallback insert
    await admin.from('audit_log').insert([{
      action,
      biz_id: bizId,
      org_id: orgId,
      user_id: userId,
      details: meta,
    }]);
  } catch (e) {
    log.warn('writeAudit failed; ignored', { error: String(e) });
  }
}
