export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import { POST as postLitoVoiceTts } from '@/app/api/lito/voice/tts/route';

export async function POST(request: Request) {
  return postLitoVoiceTts(request);
}
