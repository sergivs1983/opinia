import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

/**
 * GET /api/g/[slug]
 * PUBLIC — no auth. Redirects to target_url and records click event.
 */

/**
 * Validate that a URL is an absolute http/https URL.
 * Prevents open-redirect attacks via javascript: URLs or protocol-relative
 * //evil.com values that could be stored in growth_links.target_url.
 */
function isSafeRedirectUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(
  request: Request,
  { params }: { params: { slug: string } }
) {
  const requestId = crypto.randomUUID();
  const admin = createAdminClient();
  const { slug } = params;

  // Find link
  const { data: link } = await admin
    .from('growth_links')
    .select('id, org_id, biz_id, target_url, is_active, scan_count')
    .eq('slug', slug)
    .maybeSingle();

  // Reject if not found, inactive, or target_url is not a safe absolute URL
  if (!link || !link.is_active || !isSafeRedirectUrl(link.target_url)) {
    const fallback = NextResponse.redirect(new URL('/', request.url));
    fallback.headers.set('Cache-Control', 'no-store');
    fallback.headers.set('x-request-id', requestId);
    return fallback;
  }

  // Record event (non-blocking)
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  const ipHash = createHash('sha256').update(ip + '_growth_salt').digest('hex').slice(0, 16);
  const userAgent = request.headers.get('user-agent')?.slice(0, 300) || '';
  const referer = request.headers.get('referer')?.slice(0, 200) || '';

  // Determine event type: QR scans typically have no referer
  const eventType = (!referer || referer === '') ? 'scan' : 'click';

  // Insert event + increment scan_count (non-blocking)
  Promise.all([
    admin.from('growth_events').insert({
      link_id: link.id,
      org_id: link.org_id,
      biz_id: link.biz_id,
      event_type: eventType,
      ip_hash: ipHash,
      user_agent: userAgent,
      referer: referer || null,
    }),
    admin.from('growth_links').update({
      scan_count: (link.scan_count || 0) + 1,
    }).eq('id', link.id),
  ]).catch(e => console.error('[growth] Event tracking failed:', e?.message));

  // 302 redirect to validated target
  const redirectResponse = NextResponse.redirect(link.target_url, { status: 302 });
  redirectResponse.headers.set('Cache-Control', 'no-store');
  redirectResponse.headers.set('x-request-id', requestId);
  return redirectResponse;
}
