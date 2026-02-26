import { createAdminClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

type AuditPayload = {
  action: string;
  bizId?: string | null;
  orgId?: string | null;
  requestId?: string | null;
  userId?: string | null;
  details?: Record<string, unknown> | null;
  [k: string]: unknown;
};

export async function writeAudit(payload: AuditPayload): Promise<void> {
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : undefined;
  const log = createLogger(requestId ? { route: 'audit-log', request_id: requestId } : { route: 'audit-log' });

  const {
    action,
    bizId = null,
    orgId = null,
    requestId: _rid = null,
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

    const { error: rpcErr } = await admin.rpc('log_audit_event', {
      p_action: action,
      p_biz_id: bizId,
      p_meta_json: meta,
    });

    if (!rpcErr) return;

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
