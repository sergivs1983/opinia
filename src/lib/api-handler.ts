/**
 * withApiHandler — Unified wrapper for all API routes.
 * Provides: auth, structured logging, timing, error model, rate limiting, correlation ID.
 * Usage:
 *   export const POST = withApiHandler(async (req, ctx) => {
 *     return ctx.json({ ok: true });
 *   }, { rateLimit: 10, requireAuth: true });
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAcceptedBusinessMembershipContext, hasAcceptedBusinessMembership } from '@/lib/authz';
import { normalizeMemberRole } from '@/lib/roles';
import {
  ACTIVE_ORG_COOKIE,
  parseCookieValue,
  resolveActiveMembership,
} from '@/lib/workspace/active-org';

export interface ApiContext {
  user: { id: string; email?: string } | null;
  supabase: ReturnType<typeof createServerSupabaseClient>;
  log: ReturnType<typeof createLogger>;
  requestId: string;
  json: <T>(data: T, status?: number) => NextResponse;
  error: (code: string, message: string, status?: number) => NextResponse;
}

interface HandlerOptions {
  requireAuth?: boolean;    // default true
  rateLimit?: number;       // max requests per minute per user (0 = no limit)
  maxBodySize?: number;     // max body bytes (default 100KB)
}

type HandlerFn<P = unknown> = (request: Request, ctx: ApiContext, params?: P) => Promise<NextResponse>;

type PatternBRequestUser = { id: string; email?: string } | null;

export type PatternBAccessGranted = {
  ok: true;
  supabase: SupabaseClient;
  user: { id: string; email?: string };
  userId: string;
  bizId: string;
  role: string | null;
  membership: {
    orgId: string;
    role: string | null;
    normalizedRole: string | null;
  };
};

export type PatternBAccessDenied = NextResponse & {
  response: NextResponse;
};

export type PatternBAccessResult = PatternBAccessGranted | PatternBAccessDenied;

export type PatternBAccessContext = PatternBAccessGranted;

type PatternBImplicitBizSource = 'query' | 'header' | 'active';

export type PatternBImplicitAccessGranted = PatternBAccessGranted & {
  bizContextSource: PatternBImplicitBizSource;
};

export type PatternBImplicitAccessResult = PatternBImplicitAccessGranted | PatternBAccessDenied;

type PatternBRequestOptions = {
  supabase?: SupabaseClient;
  user?: PatternBRequestUser;
  bodyBizId?: string | null | undefined;
  queryBizId?: string | null | undefined;
  headerBizId?: string | null | undefined;
};

type PatternBMembershipScopeRow = {
  id: string;
  org_id: string;
  role: string;
  is_default: boolean;
  created_at: string | null;
  accepted_at: string | null;
};

export enum ResourceTable {
  Reviews = 'reviews',
  Drafts = 'drafts',
  Signals = 'signals',
  PublishJobs = 'publish_jobs',
  KbEntries = 'kb_entries',
  Connectors = 'connectors',
  LitoThreads = 'lito_threads',
  PlannerItems = 'content_planner_items',
  RecommendationLog = 'recommendation_log',
  Replies = 'replies',
  SocialSchedules = 'social_schedules',
  Memberships = 'memberships',
}

type ResourceLookupSpec = {
  tables: string[];
  idColumn: string;
  bizColumn: string;
  resolver?: (supabase: SupabaseClient, resourceId: string) => Promise<string | null>;
};

// ============================================================
// IN-MEMORY RATE LIMITER (per-user, per-route)
// ============================================================
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}

// Cleanup stale entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimitStore) {
      if (now > val.resetAt) rateLimitStore.delete(key);
    }
  }, 300_000);
}

// ============================================================
// BIZ-LEVEL ACCESS GUARD (defense-in-depth, layer 2 after RLS)
// ============================================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * parseBizId — valida format UUID i retorna string normalitzat o null.
 * Ús: validació lleugera sense DB. Per al guard complet, usa requireBizAccess.
 */
export function parseBizId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

/**
 * requireBizAccess — API-layer authorization guard.
 *
 * Call AFTER auth. Returns null if access is granted, or a NextResponse:
 *   400 bad_request  — bizId is not a valid UUID
 *   404 not_found    — business does not exist       (orgId === null)
 *   403 forbidden    — business exists, not a member (orgId !== null)
 *
 * Response shape on error: { error, code, message }
 *   code 'BIZ_FORBIDDEN' for 403 (machine-readable for clients)
 *
 * Never logs PII, tokens, or review content.
 */
export async function requireBizAccess({
  supabase,
  userId,
  bizId,
}: {
  supabase: SupabaseClient;
  userId: string;
  bizId: string | null | undefined;
}): Promise<NextResponse | null> {
  if (!bizId) {
    return NextResponse.json(
      { error: 'bad_request', code: 'BIZ_ID_REQUIRED', message: 'biz_id és requerit' },
      { status: 400 },
    );
  }
  if (!UUID_RE.test(bizId)) {
    return NextResponse.json(
      { error: 'bad_request', code: 'BIZ_ID_INVALID', message: 'biz_id ha de ser un UUID vàlid' },
      { status: 400 },
    );
  }

  const { allowed, orgId } = await hasAcceptedBusinessMembership({
    supabase,
    userId,
    businessId: bizId,
  });

  if (!allowed) {
    if (orgId === null) {
      return NextResponse.json(
        { error: 'not_found', code: 'BIZ_NOT_FOUND', message: 'Negoci no trobat' },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: 'forbidden', code: 'BIZ_FORBIDDEN', message: 'No tens accés a aquest negoci' },
      { status: 403 },
    );
  }

  return null;
}

function patternBNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { error: 'not_found', code: 'RESOURCE_NOT_FOUND', message: 'Recurs no trobat' },
    { status: 404 },
  );
}

function toPatternBDenied(response: NextResponse): PatternBAccessDenied {
  const denied = response as PatternBAccessDenied;
  denied.response = response;
  return denied;
}

function patternBNotFoundDenied(): PatternBAccessDenied {
  return toPatternBDenied(patternBNotFoundResponse());
}

function normalizeBizContextCandidate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getQueryBizIdCandidate(
  request: Request,
  explicitValue?: string | null | undefined,
): string | null {
  if (typeof explicitValue === 'string') {
    return normalizeBizContextCandidate(explicitValue);
  }

  const url = new URL(request.url);
  return normalizeBizContextCandidate(
    url.searchParams.get('biz_id')
      ?? url.searchParams.get('business_id')
      ?? url.searchParams.get('bizId')
      ?? url.searchParams.get('businessId'),
  );
}

function getHeaderBizIdCandidate(
  request: Request,
  explicitValue?: string | null | undefined,
): string | null {
  if (typeof explicitValue === 'string') {
    return normalizeBizContextCandidate(explicitValue);
  }

  return normalizeBizContextCandidate(
    request.headers.get('x-biz-id')
      ?? request.headers.get('x-business-id'),
  );
}

async function resolveActiveBizContextId(
  request: Request,
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const cookieOrgId = parseCookieValue(request.headers.get('cookie'), ACTIVE_ORG_COOKIE);

  const { data: membershipRows, error: membershipError } = await supabase
    .from('memberships')
    .select('id, org_id, role, is_default, created_at, accepted_at')
    .eq('user_id', userId)
    .not('accepted_at', 'is', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (membershipError || !membershipRows || membershipRows.length === 0) {
    return null;
  }

  const activeMembership = resolveActiveMembership(
    membershipRows as PatternBMembershipScopeRow[],
    cookieOrgId,
  );

  if (!activeMembership?.org_id) {
    return null;
  }

  const orgId = parseBizId(activeMembership.org_id);
  if (!orgId) {
    return null;
  }

  const normalizedRole = normalizeMemberRole(activeMembership.role);
  const isOrgWideRole = normalizedRole === 'owner' || normalizedRole === 'manager' || normalizedRole === 'admin';

  if (!isOrgWideRole) {
    const { data: assignment, error: assignmentError } = await supabase
      .from('business_memberships')
      .select('business_id')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!assignmentError && assignment) {
      const assignmentBizId = parseBizId((assignment as { business_id?: string | null }).business_id);
      if (assignmentBizId) return assignmentBizId;
    } else if (assignmentError && !isMissingRelationError(assignmentError)) {
      return null;
    }
  }

  const { data: businessData, error: businessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (businessError || !businessData) {
    return null;
  }

  return parseBizId((businessData as { id?: string | null }).id);
}

async function resolveMembershipBizId(
  supabase: SupabaseClient,
  membershipId: string,
): Promise<string | null> {
  const { data: membershipData, error: membershipError } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('id', membershipId)
    .maybeSingle();
  if (membershipError || !membershipData) return null;

  const orgId = (membershipData as { org_id?: string | null }).org_id;
  if (!parseBizId(orgId)) {
    return null;
  }

  const { data: businessData, error: businessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (businessError || !businessData) return null;

  const bizId = parseBizId((businessData as { id?: string | null }).id);
  return bizId;
}

const RESOURCE_LOOKUP: Record<ResourceTable, ResourceLookupSpec> = {
  [ResourceTable.Reviews]: {
    tables: ['reviews'],
    idColumn: 'id',
    bizColumn: 'biz_id',
  },
  [ResourceTable.Drafts]: {
    tables: ['social_drafts', 'lito_action_drafts'],
    idColumn: 'id',
    bizColumn: 'biz_id',
  },
  [ResourceTable.Signals]: {
    tables: ['biz_signals'],
    idColumn: 'id',
    bizColumn: 'biz_id',
  },
  [ResourceTable.PublishJobs]: {
    tables: ['publish_jobs'],
    idColumn: 'id',
    bizColumn: 'biz_id',
  },
  [ResourceTable.KbEntries]: {
    tables: ['kb_entries'],
    idColumn: 'id',
    bizColumn: 'biz_id',
  },
  [ResourceTable.Connectors]: {
    tables: ['connectors'],
    idColumn: 'id',
    bizColumn: 'business_id',
  },
  [ResourceTable.LitoThreads]: {
    tables: ['lito_threads'],
    idColumn: 'id',
    bizColumn: 'biz_id',
  },
  [ResourceTable.PlannerItems]: {
    tables: ['content_planner_items'],
    idColumn: 'id',
    bizColumn: 'business_id',
  },
  [ResourceTable.RecommendationLog]: {
    tables: ['recommendation_log'],
    idColumn: 'id',
    bizColumn: 'biz_id',
  },
  [ResourceTable.Replies]: {
    tables: ['replies'],
    idColumn: 'id',
    bizColumn: 'biz_id',
  },
  [ResourceTable.SocialSchedules]: {
    tables: ['social_schedules'],
    idColumn: 'id',
    bizColumn: 'biz_id',
  },
  [ResourceTable.Memberships]: {
    tables: ['memberships'],
    idColumn: 'id',
    bizColumn: 'biz_id',
    resolver: resolveMembershipBizId,
  },
};

function isMissingRelationError(error: unknown): boolean {
  const message = ((error as { message?: string })?.message || '').toLowerCase();
  return message.includes('relation')
    && message.includes('does not exist');
}

function resolvePatternBSources(
  request: Request,
  explicitBizId: string | null | undefined,
  options: PatternBRequestOptions,
): Array<string | null | undefined> {
  const url = new URL(request.url);
  const queryBizId = options.queryBizId
    ?? url.searchParams.get('biz_id')
    ?? url.searchParams.get('business_id')
    ?? url.searchParams.get('bizId')
    ?? url.searchParams.get('businessId');
  const headerBizId = options.headerBizId
    ?? request.headers.get('x-biz-id')
    ?? request.headers.get('x-business-id');
  return [explicitBizId, options.bodyBizId, queryBizId, headerBizId];
}

async function requireBizAccessPatternBArgs(
  args: Parameters<typeof requireBizAccess>[0],
): Promise<PatternBAccessDenied | null> {
  const result = await requireBizAccess(args);
  if (result !== null && result.status === 403) {
    // 403 BIZ_FORBIDDEN → 404: cross-tenant resource ≡ non-existent resource.
    // No revelem que el recurs existeix en un altre tenant.
    return patternBNotFoundDenied();
  }
  if (result === null) return null;
  return toPatternBDenied(result);
}

/**
 * requireBizAccessPatternB — Variant per a endpoints Patró B.
 *
 * Patró B: l'endpoint rep un *resource id* (p.ex. /[id]), obté el biz_id
 * del recurs per fetch previ i després aplica el guard.
 *
 * Problema de Patró A naïf en Patró B:
 *   requireBizAccess retorna 403 quan el biz existeix però l'usuari no hi
 *   pertany. En Patró B, això filtra l'existència del recurs a un altre tenant:
 *   un atacant pot enumerar IDs i distingir "és d'un altre tenant" (403) de
 *   "no existeix" (404).
 *
 * Solució: convertir 403 BIZ_FORBIDDEN → 404 RESOURCE_NOT_FOUND.
 *   - Cross-tenant: recurs inaccessible ≡ recurs inexistent → 404
 *   - Biz inexistent (bug de dades): → 404 (ja ho fa requireBizAccess)
 *   - UUID invàlid al DB: → 400 (cas degenerat, biz_id del DB sempre ha de
 *     ser UUID vàlid; si falla, exposem l'error tècnic a nivell intern)
 *
 * 403 legítim en Patró B: ÚNICAMENT quan el biz és del tenant correcte però
 * l'usuari manca d'un *rol específic* (p.ex. owner/admin). Aquesta restricció
 * de rol NO la gestiona requireBizAccess — l'endpoint l'ha de comprovar
 * explícitament amb hasAcceptedOrgMembership(allowedRoles) DESPRÉS d'aquest guard.
 */
export async function requireBizAccessPatternB(
  args: Parameters<typeof requireBizAccess>[0],
): Promise<PatternBAccessDenied | null>;
export async function requireBizAccessPatternB(
  request: Request,
  bizId: string | null | undefined,
  options?: PatternBRequestOptions,
): Promise<PatternBAccessResult>;
export async function requireBizAccessPatternB(
  arg1: Parameters<typeof requireBizAccess>[0] | Request,
  arg2?: string | null | undefined,
  arg3: PatternBRequestOptions = {},
): Promise<PatternBAccessResult | null> {
  if (!(arg1 instanceof Request)) {
    return requireBizAccessPatternBArgs(arg1);
  }

  const request = arg1;
  const options = arg3;
  const supabase = options.supabase ?? createServerSupabaseClient();

  let user = options.user ?? null;
  if (!user) {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return toPatternBDenied(
        NextResponse.json(
          { error: 'unauthorized', message: 'Auth required' },
          { status: 401 },
        ),
      );
    }
    user = { id: authUser.id, email: authUser.email ?? undefined };
  }

  const sourceCheck = assertSingleBizId(resolvePatternBSources(request, arg2, options));
  if (sourceCheck.error) return patternBNotFoundDenied();

  const normalizedBizId = parseBizId(sourceCheck.bizId);
  if (!normalizedBizId) return patternBNotFoundDenied();

  const membership = await getAcceptedBusinessMembershipContext({
    supabase,
    userId: user.id,
    businessId: normalizedBizId,
  });

  if (!membership.allowed || !membership.orgId) {
    return patternBNotFoundDenied();
  }

  return {
    ok: true,
    supabase,
    user,
    userId: user.id,
    bizId: normalizedBizId,
    role: membership.role,
    membership: {
      orgId: membership.orgId,
      role: membership.role,
      normalizedRole: membership.normalizedRole,
    },
  };
}

export async function requireImplicitBizAccessPatternB(
  request: Request,
  options: Omit<PatternBRequestOptions, 'bodyBizId'> = {},
): Promise<PatternBImplicitAccessResult> {
  const supabase = options.supabase ?? createServerSupabaseClient();

  let user = options.user ?? null;
  if (!user) {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return toPatternBDenied(
        NextResponse.json(
          { error: 'unauthorized', message: 'Auth required' },
          { status: 401 },
        ),
      );
    }
    user = { id: authUser.id, email: authUser.email ?? undefined };
  }

  const queryBizId = getQueryBizIdCandidate(request, options.queryBizId);
  const headerBizId = getHeaderBizIdCandidate(request, options.headerBizId);

  if (queryBizId && headerBizId && queryBizId !== headerBizId) {
    return patternBNotFoundDenied();
  }

  let resolvedBizId = queryBizId;
  let source: PatternBImplicitBizSource = 'query';

  if (!resolvedBizId && headerBizId) {
    resolvedBizId = headerBizId;
    source = 'header';
  }

  if (!resolvedBizId) {
    resolvedBizId = await resolveActiveBizContextId(request, supabase, user.id);
    source = 'active';
  }

  if (!resolvedBizId) {
    return patternBNotFoundDenied();
  }

  const access = await requireBizAccessPatternB(request, resolvedBizId, {
    supabase,
    user,
    queryBizId: queryBizId ?? undefined,
    headerBizId: headerBizId ?? undefined,
  });

  if (access instanceof NextResponse) {
    return access;
  }

  return {
    ...access,
    bizContextSource: source,
  };
}

async function lookupBizIdFromResource(
  supabase: SupabaseClient,
  resourceId: string,
  resourceTable: ResourceTable,
): Promise<string | null> {
  const spec = RESOURCE_LOOKUP[resourceTable];
  if (!spec) return null;

  if (spec.resolver) {
    return spec.resolver(supabase, resourceId);
  }

  for (const table of spec.tables) {
    const { data, error } = await supabase
      .from(table)
      .select(spec.bizColumn)
      .eq(spec.idColumn, resourceId)
      .maybeSingle();

    if (error) {
      if (spec.tables.length > 1 && isMissingRelationError(error)) {
        continue;
      }
      return null;
    }

    if (!data) continue;

    const row = data as unknown as Record<string, unknown>;
    const rawBizId = row[spec.bizColumn];
    const bizId = parseBizId(typeof rawBizId === 'string' ? rawBizId : null);
    return bizId;
  }

  return null;
}

export async function requireResourceAccessPatternB(
  request: Request,
  resourceId: string | null | undefined,
  resourceTable: ResourceTable,
  options: Omit<PatternBRequestOptions, 'bodyBizId' | 'queryBizId' | 'headerBizId'> = {},
): Promise<PatternBAccessResult> {
  const normalizedResourceId = parseBizId(resourceId);
  if (!normalizedResourceId) return patternBNotFoundDenied();

  const supabase = options.supabase ?? createServerSupabaseClient();
  const lookedUpBizId = await lookupBizIdFromResource(supabase, normalizedResourceId, resourceTable);
  if (!lookedUpBizId) return patternBNotFoundDenied();

  return requireBizAccessPatternB(request, lookedUpBizId, {
    supabase,
    user: options.user,
  });
}

/**
 * assertSingleBizId — input hardening anti-parameter-pollution.
 *
 * Garanteix que biz_id arriba per una sola font canònica.
 * Si dues fonts (query + body) proporcionen valors que no coincideixen,
 * retorna 400 BIZ_ID_AMBIGUOUS per evitar parameter-pollution attacks.
 *
 * Ús en POST handlers (just before requireBizAccess):
 *   const { bizId, error } = assertSingleBizId([
 *     new URL(request.url).searchParams.get('biz_id'),
 *     body.biz_id,
 *   ]);
 *   if (error) return error;
 */
export function assertSingleBizId(
  sources: Array<string | null | undefined>,
): { bizId: string; error: null } | { bizId: null; error: NextResponse } {
  const present = sources
    .map((s) => (typeof s === 'string' ? s.trim() : null))
    .filter((s): s is string => s !== null && s !== '');

  if (present.length === 0) {
    return {
      bizId: null,
      error: NextResponse.json(
        { error: 'bad_request', code: 'BIZ_ID_REQUIRED', message: 'biz_id és requerit' },
        { status: 400 },
      ),
    };
  }

  const unique = [...new Set(present)];
  if (unique.length > 1) {
    return {
      bizId: null,
      error: NextResponse.json(
        { error: 'bad_request', code: 'BIZ_ID_AMBIGUOUS', message: 'biz_id inconsistent entre query i body' },
        { status: 400 },
      ),
    };
  }

  return { bizId: unique[0], error: null };
}

// ============================================================
// ERROR RESPONSE BUILDER
// ============================================================
export function apiError(code: string, message: string, status: number = 400): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

// ============================================================
// PII REDACTION
// ============================================================
export function redactPII(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    .replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g, '[PHONE]');
}

// ============================================================
// PROMPT SANITIZATION (anti prompt-injection)
// ============================================================
export function sanitizeForPrompt(text: string): string {
  return text
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝')
    .slice(0, 2000); // hard cap
}

// ============================================================
// OBJECT REDACTION (for safe logging)
// ============================================================
const REDACT_LOG_KEYS = new Set([
  'review_text', 'content', 'ai_instructions', 'prompt',
  'access_token', 'refresh_token', 'token', 'author_name',
  'email', 'phone', 'authorization',
]);

/**
 * redact — Recursively strips sensitive keys from any object before logging.
 * Returns a new object (never mutates input). Keys matched case-insensitively.
 * Depth-capped at 6 to guard against circular / deeply-nested inputs.
 *
 * Safe metadata shape for logs: { biz_id?, org_id?, resource_id?, action?, count? }
 * Never log: review_text, prompt, tokens, emails, author names, phone numbers.
 */
export function redact(obj: unknown, _depth = 0): unknown {
  if (_depth > 6 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => redact(item, _depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = REDACT_LOG_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, _depth + 1);
  }
  return out;
}

// ============================================================
// REQUEST CONTEXT WRAPPER (lightweight, for raw route handlers)
// ============================================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRouteHandler = (request: Request, context?: any) => Promise<NextResponse>;

/**
 * withRequestContext — Lightweight wrapper for raw Next.js App Router handlers.
 *
 * Adds to EVERY handler without changing HTTP semantics:
 *   • Reads x-request-id from client header or generates a new one
 *   • Sets x-request-id on every response (success + error)
 *   • Structured logging: request_start, request_end, request_error events
 *   • Catches unhandled throws → 500 (prevents plain Node crashes)
 *
 * Usage:
 *   export const GET = withRequestContext(async function(request) { ... });
 *   export const PATCH = withRequestContext(async function(request, { params }) { ... });
 */
export function withRequestContext(handler: AnyRouteHandler): AnyRouteHandler {
  return async (request: Request, context?: unknown): Promise<NextResponse> => {
    const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
    const route = new URL(request.url).pathname;
    const method = request.method;
    const log = createLogger({ request_id: requestId, route });
    const startMs = Date.now();

    log.info('request_start', { event: 'request_start', method });

    const stamp = (resp: NextResponse): NextResponse => {
      resp.headers.set('x-request-id', requestId);
      return resp;
    };

    try {
      const resp = await handler(request, context);
      log.info('request_end', {
        event: 'request_end', method, status: resp.status, duration_ms: Date.now() - startMs,
      });
      return stamp(resp);
    } catch (err: unknown) {
      log.error('request_error', {
        event: 'request_error',
        method,
        error: err instanceof Error ? err.message : 'Unknown',
        duration_ms: Date.now() - startMs,
      });
      return stamp(NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor' },
        { status: 500 },
      ));
    }
  };
}

// ============================================================
// MAIN WRAPPER
// ============================================================
export function withApiHandler<P = unknown>(handler: HandlerFn<P>, options: HandlerOptions = {}) {
  const { requireAuth = true, rateLimit = 0 } = options;

  return async (request: Request, routeParams?: P) => {
    const startMs = Date.now();
    const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
    const route = new URL(request.url).pathname;

    const log = createLogger({ request_id: requestId, route });

    const ctx: ApiContext = {
      user: null,
      supabase: createServerSupabaseClient(),
      log,
      requestId,
      json: <T>(data: T, status: number = 200) => {
        const resp = NextResponse.json(data, { status });
        resp.headers.set('x-request-id', requestId);
        return resp;
      },
      error: (code: string, message: string, status: number = 400) => {
        const resp = NextResponse.json({ error: code, message }, { status });
        resp.headers.set('x-request-id', requestId);
        return resp;
      },
    };

    try {
      // Auth check
      if (requireAuth) {
        const { data: { user } } = await ctx.supabase.auth.getUser();
        if (!user) {
          log.warn('Unauthorized request');
          return ctx.error('unauthorized', 'Authentication required', 401);
        }
        ctx.user = { id: user.id, email: user.email };
        log.info('Authenticated', { user_id: user.id });
      }

      // Rate limit check
      if (rateLimit > 0 && ctx.user) {
        const key = `${route}:${ctx.user.id}`;
        if (!checkRateLimit(key, rateLimit)) {
          log.warn('Rate limited', { user_id: ctx.user.id, limit: rateLimit });
          return ctx.error('rate_limited', `Massa peticions. Límit: ${rateLimit}/min`, 429);
        }
      }

      // Execute handler
      const response = await handler(request, ctx, routeParams);

      const durationMs = Date.now() - startMs;
      log.info('Request completed', { status: response.status, duration_ms: durationMs });

      response.headers.set('x-request-id', requestId);
      return response;

    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;
      const errorMessage = err instanceof Error ? err.message : 'Unknown';
      const stack = err instanceof Error ? (err.stack || '').slice(0, 500) : '';
      log.error('Unhandled error', {
        error: errorMessage,
        stack,
        duration_ms: durationMs,
      });

      return ctx.error('internal_error', 'Error intern del servidor', 500);
    }
  };
}
