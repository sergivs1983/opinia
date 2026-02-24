/**
 * Audit Logger — writes to the existing activity_log table.
 * Use server-side only (supabase client with user session for RLS, or admin for service_role writes).
 *
 * activity_log schema (from schema-v2-extensions.sql):
 *   id, org_id, biz_id, user_id, action, target_type, target_id, metadata, created_at
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { JsonObject } from '@/types/json';
import { createRequestId } from '@/lib/logger';

export type AuditAction =
  | 'generate_reply'
  | 'approve_reply'
  | 'archive_reply'
  | 'create_kb'
  | 'update_kb'
  | 'delete_kb'
  | 'create_ops_action'
  | 'complete_ops_action'
  | 'delete_ops_action'
  | 'rebuild_insights'
  | 'change_plan'
  | 'connect_integration'
  | 'create_business'
  | 'update_business'
  | 'seed_demo_data'
  | 'dlq_enqueued'
  | 'dlq_retried'
  | 'dlq_resolved'
  | 'SEO_FALLBACK_APPLIED'
  | 'SEO_SCHEMA_MISSING'
  | 'ONBOARDING_DEMO_SEEDED'
  | 'panic_mode_enabled'
  | 'panic_mode_disabled';

interface AuditEntry {
  orgId: string;
  bizId?: string | null;
  userId: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: JsonObject;
}

export interface AuditLogRow {
  id: string;
  action: AuditAction;
  target_type: string | null;
  target_id: string | null;
  metadata: JsonObject;
  created_at: string;
  user_id: string | null;
}

/**
 * Write an audit log entry. Non-blocking — catches and logs errors.
 */
export async function audit(supabase: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    const metadata = { ...(entry.metadata || {}) } as JsonObject;
    const existingRequestId = typeof metadata.request_id === 'string' ? metadata.request_id.trim() : '';
    if (!existingRequestId) {
      metadata.request_id = createRequestId();
    }

    await supabase.from('activity_log').insert({
      org_id: entry.orgId,
      biz_id: entry.bizId || null,
      user_id: entry.userId,
      action: entry.action,
      target_type: entry.targetType || null,
      target_id: entry.targetId || null,
      metadata,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown';
    console.error('[audit] Failed to write audit log:', message);
  }
}

/**
 * Fetch recent audit entries for a business (for dashboard display).
 */
export async function getRecentAudit(
  supabase: SupabaseClient,
  bizId: string,
  limit: number = 20
): Promise<AuditLogRow[]> {
  const { data } = await supabase
    .from('activity_log')
    .select('id, action, target_type, target_id, metadata, created_at, user_id')
    .eq('biz_id', bizId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data || []) as AuditLogRow[]);
}

/**
 * Human-readable label for audit actions (Catalan).
 */
export const AUDIT_LABELS: Record<AuditAction, string> = {
  generate_reply: 'Respostes generades',
  approve_reply: 'Resposta publicada',
  archive_reply: 'Resposta arxivada',
  create_kb: 'Entrada KB creada',
  update_kb: 'Entrada KB actualitzada',
  delete_kb: 'Entrada KB eliminada',
  create_ops_action: 'Acció operativa creada',
  complete_ops_action: 'Acció operativa completada',
  delete_ops_action: 'Acció operativa eliminada',
  rebuild_insights: 'Insights reconstruïts',
  change_plan: 'Pla canviat',
  connect_integration: 'Integració connectada',
  create_business: 'Negoci creat',
  update_business: 'Negoci actualitzat',
  seed_demo_data: 'Dades demo carregades',
  dlq_enqueued: 'Error encuat a DLQ',
  dlq_retried: 'Reintentat des de DLQ',
  dlq_resolved: 'Resolt des de DLQ',
  SEO_FALLBACK_APPLIED: 'Fallback SEO aplicat',
  SEO_SCHEMA_MISSING: 'Schema SEO no disponible',
  ONBOARDING_DEMO_SEEDED: 'Demo onboarding carregada',
  panic_mode_enabled: 'Mode pànic activat',
  panic_mode_disabled: 'Mode pànic desactivat',
};

export const AUDIT_ICONS: Record<AuditAction, string> = {
  generate_reply: '✨',
  approve_reply: '✅',
  archive_reply: '📦',
  create_kb: '🧠',
  update_kb: '✏️',
  delete_kb: '🗑️',
  create_ops_action: '🔧',
  complete_ops_action: '✅',
  delete_ops_action: '🗑️',
  rebuild_insights: '📊',
  change_plan: '💳',
  connect_integration: '🔗',
  create_business: '🏢',
  update_business: '⚙️',
  seed_demo_data: '🎭',
  dlq_enqueued: '📥',
  dlq_retried: '🔄',
  dlq_resolved: '✅',
  SEO_FALLBACK_APPLIED: '🔁',
  SEO_SCHEMA_MISSING: '⚠️',
  ONBOARDING_DEMO_SEEDED: '🎯',
  panic_mode_enabled: '🚨',
  panic_mode_disabled: '✅',
};
