export const REQUIRED_SEO_BASE_COLUMNS = ['seo_enabled', 'seo_keywords'] as const;
export const SEO_AGGRESSIVITY_COLUMNS = ['seo_aggressivity', 'seo_aggressiveness'] as const;

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function hasSeoSchemaColumns(biz: Record<string, unknown>): boolean {
  const hasBaseColumns = REQUIRED_SEO_BASE_COLUMNS.every((column) => typeof biz[column] !== 'undefined');
  const hasAggressivityColumn = SEO_AGGRESSIVITY_COLUMNS.some((column) => typeof biz[column] !== 'undefined');
  return hasBaseColumns && hasAggressivityColumn;
}

export function getSeoSchemaMissingAuditKey(orgId: string): string {
  return `opinia.audit.seo-schema-missing.${orgId}`;
}

/**
 * Marks the SEO schema-missing audit event as sent for this org.
 * Returns true only the first time per org/browser storage.
 */
export function markSeoSchemaMissingAudit(storage: StorageLike, orgId: string): boolean {
  const key = getSeoSchemaMissingAuditKey(orgId);
  if (storage.getItem(key)) return false;
  storage.setItem(key, new Date().toISOString());
  return true;
}
