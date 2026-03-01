import 'server-only';

import { buildHmacHeaders as buildSecurityHmacHeaders } from '@/lib/security/hmac';

type BuildCronHmacHeadersArgs = {
  method: string;
  path: string;
  body: string;
};

export class CronUnavailableError extends Error {
  code: 'cron_unavailable';

  constructor(message = 'INTERNAL_HMAC_SECRET is not configured') {
    super(message);
    this.name = 'CronUnavailableError';
    this.code = 'cron_unavailable';
  }
}

export function buildHmacHeaders(args: BuildCronHmacHeadersArgs): {
  'x-opin-timestamp': string;
  'x-opin-signature': string;
} {
  const secret = process.env.INTERNAL_HMAC_SECRET;
  if (!secret) {
    throw new CronUnavailableError();
  }

  return buildSecurityHmacHeaders({
    method: args.method,
    pathname: args.path,
    rawBody: args.body,
    secret,
  });
}
