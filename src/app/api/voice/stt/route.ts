export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import { POST as postLitoVoiceStt } from '@/app/api/lito/voice/stt/route';

export async function POST(request: Request) {
  return postLitoVoiceStt(request);
}
