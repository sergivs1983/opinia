export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest } from 'next/server';

import { handleInternalWorkerStub } from '@/lib/internal-workers/stub';

export async function POST(request: NextRequest) {
  return handleInternalWorkerStub(
    request,
    '/api/_internal/tripadvisor/publish',
    { processed: 0, failed: 0, stub: true },
  );
}
