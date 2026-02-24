import { NextRequest, NextResponse } from 'next/server';

type MiddlewareOptions = {
  locales: readonly string[];
  defaultLocale: string;
};

export default function createMiddleware(options: MiddlewareOptions) {
  const localesSet = new Set(options.locales);

  return function intlMiddleware(request: NextRequest): NextResponse | undefined {
    const pathname = request.nextUrl.pathname;
    const firstSegment = pathname.split('/')[1] || '';

    if (!firstSegment || localesSet.has(firstSegment)) {
      return undefined;
    }

    // Keep default behavior of the existing app (no forced locale prefix).
    // This helper stays no-op unless the app decides to mount locale-prefixed pages.
    return undefined;
  };
}

