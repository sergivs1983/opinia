import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';

// ── Inlined from @/i18n/config to keep the Edge bundle self-contained ──
const locales = ['ca', 'es', 'en'] as const;
type Locale = (typeof locales)[number];
const defaultLocale: Locale = 'ca';
const LOCALE_COOKIE = 'opinia_locale';
function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

// ── Inlined from @/lib/logger (only createRequestId is needed here) ──
let _reqCounter = 0;
function createRequestId(): string {
  return `req_${Date.now()}_${(++_reqCounter).toString(36)}`;
}

/**
 * OpinIA Middleware v3 — i18n via cookie, NO /[locale] routes for dashboard.
 *
 * Strategy:
 *   /es/dashboard/settings → set cookie es → redirect /dashboard/settings
 *   /es                    → set cookie es → redirect /
 *   /dashboard/*           → Supabase session + auth guard (normal)
 *   /api/*                 → Supabase session only
 */

const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
});

function shouldSkip(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return true;
  if (pathname.startsWith('/_next')) return true;
  if (pathname === '/favicon.ico') return true;
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static/api
  if (shouldSkip(pathname)) {
    if (pathname.startsWith('/api/')) {
      const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-request-id', requestId);

      const response = await supabaseRefresh(request, requestHeaders);
      response.headers.set('x-request-id', requestId);
      return response;
    }
    return NextResponse.next();
  }

  // ── STRIP LOCALE PREFIX ──
  // /es/dashboard/settings → cookie=es, redirect /dashboard/settings
  // /ca → cookie=ca, redirect /
  const firstSeg = pathname.split('/')[1];
  if (firstSeg && isLocale(firstSeg)) {
    intlMiddleware(request);
    const rest = pathname.slice(firstSeg.length + 1) || '/';
    const url = request.nextUrl.clone();
    url.pathname = rest;
    const res = NextResponse.redirect(url);
    res.cookies.set(LOCALE_COOKIE, firstSeg, { path: '/', maxAge: 31536000, sameSite: 'lax' });
    return res;
  }

  // ── NORMAL ROUTES (no locale prefix) ──
  let response = await supabaseRefresh(request);

  // Auth guard: /dashboard, /onboarding require login
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/onboarding')) {
    const user = await getUser(request);
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('redirect', pathname);
      return NextResponse.redirect(url);
    }
  }

  // Redirect logged-in from /login
  if (pathname === '/login') {
    const user = await getUser(request);
    if (user) {
      return NextResponse.redirect(new URL('/dashboard/inbox', request.url));
    }
  }

  return response;
}

// ── Supabase session refresh ──
async function supabaseRefresh(request: NextRequest, requestHeaders: Headers = request.headers): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value; },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );
  await supabase.auth.getUser();
  return response;
}

async function getUser(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return request.cookies.get(name)?.value; }, set() {}, remove() {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
