import crypto from 'crypto';

type ObjArgs = {
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

/** Overload 1 (worker): validateHmacHeader({ ... }) */
export function validateHmacHeader(args: ObjArgs): boolean;
/** Overload 2 (classic): validateHmacHeader(req, rawBody, secret, pathname?, maxSkewMs?) */
export function validateHmacHeader(
  req: Request,
  rawBody: string,
  secret: string,
  pathname?: string,
  maxSkewMs?: number,
): boolean;

export function validateHmacHeader(
  a: ObjArgs | Request,
  b?: string,
  c?: string,
  d?: string,
  e?: number,
): boolean {
  // ── Object form (worker) ────────────────────────────────────────────────
  if (typeof (a as any).timestampHeader !== 'undefined') {
    const args = a as ObjArgs;
    const ts = args.timestampHeader ?? '';
    const sig = args.signatureHeader ?? '';
    const maxSkewMs = args.maxSkewMs ?? 5 * 60 * 1000;

    if (!isDigits(ts) || !isHex64(sig)) return false;

    const t = Number(ts);
    if (!Number.isFinite(t)) return false;

    if (Math.abs(Date.now() - t) > maxSkewMs) return false;

    const bodyHex = sha256Hex(args.rawBody);
    const canonical = `${ts}.${args.method.toUpperCase()}.${args.pathname}.${bodyHex}`;
    const expected = hmacHex(args.secret, canonical);

    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  // ── Classic form ───────────────────────────────────────────────────────
  const req = a as Request;
  const rawBody = b ?? '';
  const secret = c ?? '';
  const pathname = d ?? new URL(req.url).pathname;
  const maxSkewMs = e ?? 5 * 60 * 1000;

  const ts = req.headers.get('x-opin-timestamp') ?? '';
  const sig = req.headers.get('x-opin-signature') ?? '';

  if (!isDigits(ts) || !isHex64(sig)) return false;

  const t = Number(ts);
  if (!Number.isFinite(t)) return false;

  if (Math.abs(Date.now() - t) > maxSkewMs) return false;

  const bodyHex = sha256Hex(rawBody);
  const canonical = `${ts}.${req.method.toUpperCase()}.${pathname}.${bodyHex}`;
  const expected = hmacHex(secret, canonical);

  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
