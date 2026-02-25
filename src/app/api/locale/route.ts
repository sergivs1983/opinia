export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { LOCALE_COOKIE } from '@/i18n/config';
import { validateBody, LocaleSchema } from '@/lib/validations';

/**
 * POST /api/locale
 * Body: { locale: 'ca' | 'es' | 'en' }
 * Sets cookie + updates profiles.locale if authenticated.
 */
export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  // ── Validate ──
  const [body, err] = await validateBody(request, LocaleSchema);
  if (err) return err;

  const response = NextResponse.json({ ok: true, locale: body.locale });

  response.cookies.set(LOCALE_COOKIE, body.locale, {
    path: '/',
    maxAge: 31536000,
    sameSite: 'lax',
  });

  // Update DB if authenticated (non-blocking)
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('profiles').update({ locale: body.locale }).eq('id', user.id);
    }
  } catch {
    // Non-blocking
  }

  return response;
}
