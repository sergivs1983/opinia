import { createAdminClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

/**
 * writeAudit — best-effort audit writer.
 * Signature matches worker usage: writeAudit({ ... }).
 * Never throws. Audit must not break prod flows.
 */
export async function writeAudit(payload: {
  bizId?: string | null;
  orgId?: string | null;
  requestId?: string | null;
  userId?: string | null;
  action: string;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  const log = createLogger({ route: 'audit-log', request_id: payload.requestId ?? undefined });

  // Prefer RPC if available; fallback to insert.
  try {
    const admin = createAdminClient();

    // RPC path (whitelisted)
    const { error: rpcErr } = await admin.rpc('log_audit_event', {
      p_action: payload.action,
      p_biz_id: payload.bizId,
      p_meta_json: {
        request_id: payload.requestId,
        org_id: payload.orgId,
        user_id: payload.userId,
        ...(payload.details ?? {}),
      },
    });

    if (!rpcErr) return;

    // Fallback insert (only if permitted for service_role)
    await admin.from('audit_log').insert([{
      action: payload.action,
      biz_id: payload.bizId,
      org_id: payload.orgId,
      user_id: payload.userId,
      details: {
        request_id: payload.requestId,
        ...(payload.details ?? {}),
      },
    }]);
  } catch (e) {
    log.warn('writeAudit failed; ignored', { error: String(e) });
  }
}
