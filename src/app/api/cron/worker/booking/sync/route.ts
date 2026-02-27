export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest } from 'next/server';

import { handleInternalWorkerStub } from '@/lib/internal-workers/stub';

export async function POST(request: NextRequest) {
  return handleInternalWorkerStub(
    request,
    '/api/_internal/booking/sync',
    { synced: 0, new: 0, stub: true },
  );
}
