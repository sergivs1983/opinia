export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

import { requireInternalGuard } from '@/lib/internal-guard';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  canonicalPlanFromAny,
  getEntitlementsForPlan,
  getPlanFromStripePrice,
  type CanonicalPlanCode,
} from '@/lib/billing/stripe-plans';
import { trackEvent } from '@/lib/telemetry';

type StripeEventEnvelope = {
  id: string;
  type: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isDuplicateKeyError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '').toLowerCase();
  return code === '23505' || message.includes('duplicate key');
}

function isMissingTableError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '').toLowerCase();
  return code === '42P01' || message.includes('does not exist') || message.includes('schema cache');
}

function firstItemPriceId(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const items = input as { data?: Array<{ price?: { id?: string } }> };
  const priceId = items.data?.[0]?.price?.id;
  return asString(priceId);
}

async function fetchCheckoutLineItemPriceId(sessionId: string, stripeSecretKey: string): Promise<string | null> {
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?limit=1`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) return null;

  const json = (await response.json().catch(() => null)) as
    | { data?: Array<{ price?: { id?: string } }> }
    | null;
  if (!json?.data?.length) return null;
  return asString(json.data[0]?.price?.id);
}

async function findOrgIdByStripeCustomer(admin: ReturnType<typeof createAdminClient>, customerId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return asString((data as { id?: string }).id);
}

async function applyCanonicalPlan(args: {
  admin: ReturnType<typeof createAdminClient>;
  orgId: string;
  planCode: CanonicalPlanCode;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  billingStatus?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const entitlements = getEntitlementsForPlan(args.planCode);
  const orgPayload: Record<string, unknown> = {
    plan_code: args.planCode,
    plan: args.planCode,
    max_businesses: entitlements.locations_limit,
    max_team_members: entitlements.seats_limit,
    max_reviews_mo: entitlements.drafts_limit,
    seats_limit: entitlements.seats_limit,
    business_limit: entitlements.locations_limit,
    plan_price_cents: entitlements.monthly_price_cents,
    billing_status: args.billingStatus || 'active',
    stripe_customer_id: args.stripeCustomerId || null,
    stripe_subscription_id: args.stripeSubscriptionId || null,
    stripe_price_id: args.stripePriceId || null,
  };

  let { error: orgError } = await args.admin
    .from('organizations')
    .update(orgPayload)
    .eq('id', args.orgId);

  if (orgError && isMissingTableError(orgError)) {
    return { ok: false, error: orgError.message || 'organizations_missing' };
  }

  if (orgError) {
    const fallbackPayload = {
      plan_code: args.planCode,
      plan: args.planCode,
      max_businesses: entitlements.locations_limit,
      max_team_members: entitlements.seats_limit,
      max_reviews_mo: entitlements.drafts_limit,
    };
    const retry = await args.admin.from('organizations').update(fallbackPayload).eq('id', args.orgId);
    orgError = retry.error;
    if (orgError) {
      return { ok: false, error: orgError.message || 'org_update_failed' };
    }
  }

  const { error: entitlementError } = await args.admin.from('org_entitlements').upsert(
    {
      org_id: args.orgId,
      locations_limit: entitlements.locations_limit,
      seats_limit: entitlements.seats_limit,
      lito_drafts_limit: entitlements.drafts_limit,
      signals_level: entitlements.signals_level,
      staff_daily_limit: 10,
      staff_monthly_ratio_cap: 0.3,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id' },
  );

  if (entitlementError && !isMissingTableError(entitlementError)) {
    return { ok: false, error: entitlementError.message || 'org_entitlements_upsert_failed' };
  }

  return { ok: true };
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/stripe/webhook' });

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return withStandardHeaders(
      NextResponse.json(
        { ok: false, error: 'stripe_unavailable', message: 'Missing Stripe webhook configuration', request_id: requestId },
        { status: 503 },
      ),
      requestId,
    );
  }

  const rawBody = await request.text();
  const guardBlocked = requireInternalGuard(request, {
    requestId,
    mode: 'stripe',
    rawBody,
  });
  if (guardBlocked) return withStandardHeaders(guardBlocked, requestId);

  let event: StripeEventEnvelope;
  try {
    event = JSON.parse(rawBody) as StripeEventEnvelope;
  } catch {
    return withStandardHeaders(
      NextResponse.json({ ok: false, error: 'invalid_payload', request_id: requestId }, { status: 400 }),
      requestId,
    );
  }

  if (!event?.id || !event?.type) {
    return withStandardHeaders(
      NextResponse.json({ ok: false, error: 'invalid_event', request_id: requestId }, { status: 400 }),
      requestId,
    );
  }

  const admin = createAdminClient();
  const { error: ledgerError } = await admin.from('stripe_webhook_events').insert({
    id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });

  if (ledgerError && isDuplicateKeyError(ledgerError)) {
    return withStandardHeaders(
      NextResponse.json({ ok: true, duplicate: true, request_id: requestId }),
      requestId,
    );
  }

  if (ledgerError && !isMissingTableError(ledgerError)) {
    log.error('stripe_webhook_ledger_insert_failed', {
      error_code: ledgerError.code || null,
      error: ledgerError.message || null,
      event_id: event.id,
      event_type: event.type,
    });
    return withStandardHeaders(
      NextResponse.json({ ok: false, error: 'ledger_insert_failed', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = (event.data?.object || {}) as Record<string, unknown>;
      const metadata = (session.metadata || {}) as Record<string, unknown>;
      const sessionId = asString(session.id);
      const customerId = asString(session.customer);
      const subscriptionId = asString(session.subscription);
      const orgIdFromMetadata = asString(metadata.org_id);
      const targetPlan = canonicalPlanFromAny(asString(metadata.target_plan));
      const lineItemPriceId = sessionId ? await fetchCheckoutLineItemPriceId(sessionId, stripeSecretKey) : null;
      const mappedPlan = getPlanFromStripePrice(lineItemPriceId) || targetPlan;

      const orgId = orgIdFromMetadata || (customerId ? await findOrgIdByStripeCustomer(admin, customerId) : null);
      if (orgId && mappedPlan) {
        const applied = await applyCanonicalPlan({
          admin,
          orgId,
          planCode: mappedPlan,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: lineItemPriceId,
          billingStatus: 'active',
        });

        if (!applied.ok) {
          log.error('stripe_webhook_checkout_apply_failed', {
            org_id: orgId,
            event_id: event.id,
            event_type: event.type,
            reason: applied.error || 'unknown',
          });
        } else {
          await trackEvent({
            supabase: admin,
            orgId,
            userId: null,
            name: 'checkout_success',
            props: {
              source: 'stripe_webhook',
              plan: mappedPlan,
              stripe_event: event.type,
            },
            requestId,
          });
        }
      }
    } else if (event.type === 'customer.subscription.updated') {
      const subscription = (event.data?.object || {}) as Record<string, unknown>;
      const metadata = (subscription.metadata || {}) as Record<string, unknown>;
      const orgIdFromMetadata = asString(metadata.org_id);
      const customerId = asString(subscription.customer);
      const subscriptionId = asString(subscription.id);
      const priceId = firstItemPriceId(subscription.items);
      const mappedPlan = getPlanFromStripePrice(priceId) || canonicalPlanFromAny(asString(metadata.target_plan));
      const orgId = orgIdFromMetadata || (customerId ? await findOrgIdByStripeCustomer(admin, customerId) : null);

      if (orgId && mappedPlan) {
        await applyCanonicalPlan({
          admin,
          orgId,
          planCode: mappedPlan,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: priceId,
          billingStatus: 'active',
        });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = (event.data?.object || {}) as Record<string, unknown>;
      const metadata = (subscription.metadata || {}) as Record<string, unknown>;
      const orgIdFromMetadata = asString(metadata.org_id);
      const customerId = asString(subscription.customer);
      const orgId = orgIdFromMetadata || (customerId ? await findOrgIdByStripeCustomer(admin, customerId) : null);

      if (orgId) {
        await applyCanonicalPlan({
          admin,
          orgId,
          planCode: 'starter',
          stripeCustomerId: customerId,
          stripeSubscriptionId: null,
          stripePriceId: null,
          billingStatus: 'canceled',
        });
      }
    }
  } catch (error) {
    log.error('stripe_webhook_unhandled', {
      event_id: event.id,
      event_type: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ ok: false, error: 'internal', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }

  return withStandardHeaders(
    NextResponse.json({ ok: true, event_id: event.id, event_type: event.type, request_id: requestId }),
    requestId,
  );
}
