import crypto from 'crypto';

type ObjArgs = {
  timestampHeader: string | null;
  signatureHeader: string | null;
  method: string;
  pathname: string;
  rawBody: string;
  secret?: string;    // default from env
  maxSkewMs?: number; // default 5 min
};

type BuildArgs = {
  method: string;
  pathname: string;
  rawBody: string;
  secret: string;
  timestampMs?: string;
};

export type HmacValidationResult = { valid: true } | { valid: false; reason: string };

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

function resolveSecret(explicit?: string): string | null {
  return explicit ?? process.env.INTERNAL_HMAC_SECRET ?? null;
}

export function buildHmacHeaders(args: BuildArgs): { 'x-opin-timestamp': string; 'x-opin-signature': string } {
  const ts = args.timestampMs ?? Date.now().toString();
  const bodyHex = sha256Hex(args.rawBody);
  const canonical = `${ts}.${args.method.toUpperCase()}.${args.pathname}.${bodyHex}`;
  const sig = hmacHex(args.secret, canonical);
  return { 'x-opin-timestamp': ts, 'x-opin-signature': sig };
}

/**
 * validateHmacHeader — canonical worker validator.
 * Returns structured result: { valid, reason } for safe logging.
 */
export function validateHmacHeader(args: ObjArgs): HmacValidationResult {
  const ts = args.timestampHeader ?? '';
  const sig = args.signatureHeader ?? '';
  const maxSkewMs = args.maxSkewMs ?? 5 * 60 * 1000;

  const secret = resolveSecret(args.secret);
  if (!secret) return { valid: false, reason: 'missing_secret' };

  if (!isDigits(ts)) return { valid: false, reason: 'bad_timestamp' };
  if (!isHex64(sig)) return { valid: false, reason: 'bad_signature_format' };

  const t = Number(ts);
  if (!Number.isFinite(t)) return { valid: false, reason: 'bad_timestamp_number' };

  if (Math.abs(Date.now() - t) > maxSkewMs) return { valid: false, reason: 'replay_window' };

  const bodyHex = sha256Hex(args.rawBody);
  const canonical = `${ts}.${args.method.toUpperCase()}.${args.pathname}.${bodyHex}`;
  const expected = hmacHex(secret, canonical);

  try {
    const ok = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    return ok ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
  } catch {
    return { valid: false, reason: 'timing_safe_equal_error' };
  }
}

/** Convenience boolean wrapper if needed elsewhere */
export function isValidHmac(args: ObjArgs): boolean {
  return validateHmacHeader(args).valid;
}
