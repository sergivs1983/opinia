import { NextRequest, NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL('/login', request.url));
}
