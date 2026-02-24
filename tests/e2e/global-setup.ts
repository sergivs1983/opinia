import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FullConfig } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
import type { E2ESeedState } from './state';

const STATE_PATH = path.join(process.cwd(), '.e2e', 'state.json');

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[e2e] Missing required env var: ${name}`);
  }
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createSeedUser(
  admin: ReturnType<typeof createClient>,
  label: string,
  runId: string,
) {
  const email = `e2e-${label}-${runId}@opinia-e2e.test`;
  const password = `E2E-${randomUUID().slice(0, 8)}-${randomUUID().slice(0, 8)}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `E2E ${label}` },
  });

  if (error || !data.user) {
    throw new Error(`[e2e] Failed to create user (${label}): ${error?.message || 'unknown error'}`);
  }

  const userId = data.user.id;
  const fullName = `E2E ${label}`;

  await admin.from('profiles').upsert(
    { id: userId, full_name: fullName, avatar_url: '', locale: 'ca' },
    { onConflict: 'id' },
  );

  return { userId, email, password };
}

async function ensureOrgWithMembership(
  admin: ReturnType<typeof createClient>,
  userId: string,
  orgName: string,
) {
  // Some projects auto-create org/membership via DB trigger after auth user creation.
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: existingMembership } = await admin
      .from('memberships')
      .select('org_id')
      .eq('user_id', userId)
      .not('accepted_at', 'is', null)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingMembership?.org_id) {
      return existingMembership.org_id;
    }

    await sleep(150);
  }

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: orgName })
    .select('id')
    .single();

  if (orgError || !org) {
    throw new Error(`[e2e] Failed to create organization: ${orgError?.message || 'unknown error'}`);
  }

  const { error: membershipError } = await admin.from('memberships').insert({
    user_id: userId,
    org_id: org.id,
    role: 'owner',
    is_default: true,
    accepted_at: new Date().toISOString(),
  });

  if (membershipError) {
    throw new Error(`[e2e] Failed to create membership: ${membershipError.message}`);
  }

  return org.id;
}

async function createBusinessWithReview(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  runId: string,
) {
  const slug = `e2e-biz-${runId}`;
  const businessName = `E2E Business ${runId}`;

  const { data: business, error: businessError } = await admin
    .from('businesses')
    .insert({
      org_id: orgId,
      name: businessName,
      slug,
      type: 'hotel',
      url: null,
      city: 'Tarragona',
      tags: ['e2e'],
      default_signature: `L'equip de ${businessName}`,
      formality: 'voste',
      default_language: 'ca',
      ai_instructions: null,
      onboarding_done: true,
      is_active: true,
    })
    .select('id')
    .single();

  if (businessError || !business) {
    throw new Error(`[e2e] Failed to create business: ${businessError?.message || 'unknown error'}`);
  }

  const { data: review, error: reviewError } = await admin
    .from('reviews')
    .insert({
      biz_id: business.id,
      org_id: orgId,
      source: 'google',
      author_name: 'E2E Guest',
      review_text: 'Bona experiència general. Habitació neta i personal amable.',
      rating: 4,
      sentiment: 'positive',
      language_detected: 'ca',
      needs_attention: false,
      is_replied: false,
      review_date: new Date().toISOString(),
      metadata: { e2e: true, runId },
    })
    .select('id')
    .single();

  if (reviewError || !review) {
    throw new Error(`[e2e] Failed to create review: ${reviewError?.message || 'unknown error'}`);
  }

  return { bizId: business.id, reviewId: review.id };
}

export default async function globalSetup(_config: FullConfig) {
  loadEnvConfig(process.cwd());

  const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`.toLowerCase();

  const onboardingUser = await createSeedUser(admin, 'onboarding', runId);
  const onboardingOrgId = await ensureOrgWithMembership(admin, onboardingUser.userId, `E2E Onboarding Org ${runId}`);

  const coreUser = await createSeedUser(admin, 'core', runId);
  const coreOrgId = await ensureOrgWithMembership(admin, coreUser.userId, `E2E Core Org ${runId}`);
  const { bizId, reviewId } = await createBusinessWithReview(admin, coreOrgId, runId);

  const state: E2ESeedState = {
    runId,
    onboarding: {
      email: onboardingUser.email,
      password: onboardingUser.password,
      userId: onboardingUser.userId,
      orgId: onboardingOrgId,
    },
    core: {
      email: coreUser.email,
      password: coreUser.password,
      userId: coreUser.userId,
      orgId: coreOrgId,
      bizId,
      reviewId,
    },
  };

  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}
