export const ACTIVE_ORG_COOKIE = 'active_org_id';
export const ACTIVE_ORG_STORAGE_KEY = 'opinia.active_org_id';
export const ACTIVE_ORG_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days

export type MembershipSelectorRow = {
  id: string;
  org_id: string;
  is_default: boolean;
  created_at: string | null;
  accepted_at?: string | null;
};

function toTimestamp(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

export function parseCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    const rawValue = trimmed.slice(name.length + 1);
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

export function getClientCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return parseCookieValue(document.cookie, name);
}

function getClientStorageValue(name: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(name);
  } catch {
    return null;
  }
}

export function setClientCookieValue(
  name: string,
  value: string,
  options: { path?: string; maxAgeSeconds?: number; sameSite?: 'Lax' | 'Strict' | 'None' } = {},
) {
  if (typeof document === 'undefined') return;

  const path = options.path ?? '/';
  const maxAgeSeconds = options.maxAgeSeconds ?? ACTIVE_ORG_COOKIE_MAX_AGE_SECONDS;
  const sameSite = options.sameSite ?? 'Lax';
  const encodedValue = encodeURIComponent(value);

  document.cookie = `${name}=${encodedValue}; Path=${path}; Max-Age=${maxAgeSeconds}; SameSite=${sameSite}`;
}

function setClientStorageValue(name: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(name, value);
  } catch {}
}

export function getActiveOrgCookieValue(): string | null {
  return getClientCookieValue(ACTIVE_ORG_COOKIE);
}

export function setActiveOrgCookieValue(orgId: string) {
  setClientCookieValue(ACTIVE_ORG_COOKIE, orgId);
}

export function getStoredActiveOrgId(): string | null {
  const cookieValue = getClientCookieValue(ACTIVE_ORG_COOKIE);
  if (cookieValue) return cookieValue;
  return getClientStorageValue(ACTIVE_ORG_STORAGE_KEY);
}

export function setStoredActiveOrgId(orgId: string) {
  setClientStorageValue(ACTIVE_ORG_STORAGE_KEY, orgId);
  setActiveOrgCookieValue(orgId);
}

function sortMembershipRowsOldestFirst<T extends MembershipSelectorRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byCreatedAt = toTimestamp(a.created_at) - toTimestamp(b.created_at);
    if (byCreatedAt !== 0) return byCreatedAt;
    return a.id.localeCompare(b.id);
  });
}

export function dedupeMembershipRowsByOrg<T extends MembershipSelectorRow>(rows: T[]): T[] {
  const deduped = new Map<string, T>();
  for (const row of sortMembershipRowsOldestFirst(rows)) {
    if (deduped.has(row.org_id)) continue;
    deduped.set(row.org_id, row);
  }
  return Array.from(deduped.values());
}

export function resolveActiveMembership<T extends MembershipSelectorRow>(
  rows: T[],
  storedOrgId?: string | null,
): T | null {
  const activeRows = sortMembershipRowsOldestFirst(
    rows.filter((row) => row.accepted_at === undefined || row.accepted_at !== null),
  );
  if (!activeRows.length) return null;

  if (storedOrgId) {
    const byStoredId = activeRows.find((row) => row.org_id === storedOrgId);
    if (byStoredId) return byStoredId;
  }

  const defaults = activeRows.filter((row) => row.is_default);
  if (defaults.length > 0) return defaults[0];

  return activeRows[0];
}

export function resolveActiveOrgId<T extends MembershipSelectorRow>(
  argsOrRows: { memberships: T[]; storedId?: string | null } | T[],
  storedId?: string | null,
): string | null {
  const memberships = Array.isArray(argsOrRows)
    ? argsOrRows
    : argsOrRows.memberships;
  const resolvedStoredId = Array.isArray(argsOrRows)
    ? storedId
    : argsOrRows.storedId;
  return resolveActiveMembership(memberships, resolvedStoredId)?.org_id ?? null;
}
