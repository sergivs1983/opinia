import crypto from 'node:crypto';

type ValidateArgs = {
  timestampHeader: string | null;
  signatureHeader: string | null;
  method: string;
  pathname: string;
  rawBody: string;
  secret: string;
  maxSkewMs?: number; // default 5 min
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
  const ts = args.timestampHeader ?? '';
  const sig = args.signatureHeader ?? '';
  const maxSkewMs = args.maxSkewMs ?? 5 * 60 * 1000;

  if (!isDigits(ts) || !isHex64(sig)) return false;

  const t = Number(ts);
  if (!Number.isFinite(t)) return false;

  const skew = Math.abs(Date.now() - t);
  if (skew > maxSkewMs) return false;

  const bodyHex = sha256Hex(args.rawBody);
  const canonical = `${ts}.${args.method.toUpperCase()}.${args.pathname}.${bodyHex}`;
  const expected = hmacHex(args.secret, canonical);

  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
