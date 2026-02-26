import crypto from 'crypto';

type ValidateArgs = {
  request: Request;
  rawBody: string;
  secret: string;
  /** Optional: canonical pathname override. If omitted, uses new URL(request.url).pathname */
  pathname?: string;
  /** Optional: allow overriding max skew (ms). Default 5 minutes. */
  maxSkewMs?: number;
};

type BuildArgs = {
  method: string;
  pathname: string;
  rawBody: string;
  secret: string;
  timestampMs?: string;
};

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input ?? '').digest('hex');
}

function hmacHex(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function isHex64(s: string): boolean {
  return /^[a-f0-9]{64}$/i.test(s);
}

function isDigits(s: string): boolean {
  return /^\d+$/.test(s);
}

export function buildHmacHeaders(args: BuildArgs): { 'x-opin-timestamp': string; 'x-opin-signature': string } {
  const ts = args.timestampMs ?? Date.now().toString();
  const bodyHex = sha256Hex(args.rawBody);
  const canonical = `${ts}.${args.method.toUpperCase()}.${args.pathname}.${bodyHex}`;
  const sig = hmacHex(args.secret, canonical);
  return { 'x-opin-timestamp': ts, 'x-opin-signature': sig };
}

export function validateHmacHeader(args: ValidateArgs): boolean {
  const { request, rawBody, secret } = args;
  const maxSkewMs = args.maxSkewMs ?? 5 * 60 * 1000;

  const ts = request.headers.get('x-opin-timestamp') ?? '';
  const sig = request.headers.get('x-opin-signature') ?? '';
  if (!isDigits(ts) || !isHex64(sig)) return false;

  const t = Number(ts);
  if (!Number.isFinite(t)) return false;

  const skew = Math.abs(Date.now() - t);
  if (skew > maxSkewMs) return false;

  const url = new URL(request.url);
  const pathname = args.pathname ?? url.pathname;

  const bodyHex = sha256Hex(rawBody);
  const canonical = `${ts}.${request.method.toUpperCase()}.${pathname}.${bodyHex}`;
  const expected = hmacHex(secret, canonical);

  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
