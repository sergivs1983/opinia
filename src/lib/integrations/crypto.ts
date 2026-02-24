import { createHmac } from 'node:crypto';

export function signPayload(secret: string, rawBodyString: string): string {
  return createHmac('sha256', secret).update(rawBodyString).digest('hex');
}

