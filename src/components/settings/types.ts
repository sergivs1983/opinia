/**
 * Shared types for Settings sub-components.
 * Uses typed props from database.ts.
 */
import type { Business, Organization } from '@/types/database';

/** Props for components that need business + a save callback */
export interface BizSettingsProps {
  biz: Business;
  onSaved: () => void;
}

/** Props for components that need business + organization */
export interface BizOrgProps {
  biz: Business;
  org: Organization;
}

/** Props for components that need only organization */
export interface OrgProps {
  org: Organization;
}

/** Props for components that need business + organization + save callback */
export interface SafetySettingsProps {
  biz: Business;
  org: Organization;
  onSaved: () => void;
}

// Backward-compatible alias.
export type SafetyProps = SafetySettingsProps;
