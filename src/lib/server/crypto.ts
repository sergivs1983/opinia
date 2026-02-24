/**
 * src/lib/server/crypto.ts — AES-256-GCM token encryption.
 *
 * SECURITY CONTRACT:
 *   • Server-only. Never import from client components or NEXT_PUBLIC_ paths.
 *   • Keys loaded exclusively from server env vars (OAUTH_ENCRYPTION_KEY_V{n}).
 *   • Never logs plaintext, keys, or raw ciphertext.
 *   • AAD = integration_id prevents ciphertext reuse across integrations.
 *
 * ENVELOPE FORMAT (base64url):
 *   IV[12 bytes] || AuthTag[16 bytes] || Ciphertext[variable]
 *   Total binary = 28 + plaintext_bytes bytes.
 *   base64url: no padding, URL-safe, no delimiters.
 *
 * KEY FORMAT:
 *   OAUTH_ENCRYPTION_KEY_V{n} env var: hex (64 chars) OR base64 (44 chars) for 32 bytes.
 *   Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO    = 'aes-256-gcm' as const;
const IV_LEN  = 12;   // 96-bit nonce — GCM standard, prevents counter wrap-around
const TAG_LEN = 16;   // 128-bit authentication tag — GCM default

/** Current active key version used for all new encryptions. */
export const CURRENT_KEY_VERSION = 1;

// ============================================================
// KEY RESOLVER
// ============================================================

/**
 * getKeyByVersion — Load and validate an encryption key by version number.
 *
 * Reads OAUTH_ENCRYPTION_KEY_V{version} from env.
 * Accepts hex (64 chars = 32 bytes) or base64 (44 chars = 32 bytes).
 * Throws immediately (fail-fast) if missing, wrong size, or undecodable.
 * NEVER logs the key value.
 */
export function getKeyByVersion(version: number): Buffer {
  const envVar = `OAUTH_ENCRYPTION_KEY_V${version}`;
  const raw = process.env[envVar];

  if (!raw || raw.trim() === '') {
    throw new Error(`[crypto] Missing required env var ${envVar}. `
      + 'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }

  const trimmed = raw.trim();
  let buf: Buffer;

  try {
    if (trimmed.length === 64) {
      // Hex: 64 hex chars = 32 bytes
      buf = Buffer.from(trimmed, 'hex');
    } else {
      // Base64/base64url: 44 chars = 32 bytes (with padding) or 43 without
      buf = Buffer.from(trimmed, 'base64');
    }
  } catch {
    throw new Error(`[crypto] ${envVar} could not be decoded as hex or base64.`);
  }

  if (buf.length !== 32) {
    throw new Error(
      `[crypto] ${envVar} must decode to exactly 32 bytes (AES-256). `
      + `Got ${buf.length} bytes. Use hex (64 chars) or base64 (44 chars).`,
    );
  }

  return buf;
}

// ============================================================
// ENCRYPT
// ============================================================

/**
 * encryptToken — Encrypt a plaintext token string with AES-256-GCM.
 *
 * @param plaintext  Raw token string (access_token or refresh_token).
 * @param aad        Additional Authenticated Data — use integration_id (UUID string).
 *                   Prevents ciphertext from one integration being replayed on another.
 * @param version    Key version to use. Defaults to CURRENT_KEY_VERSION.
 * @returns          { enc: base64url envelope, key_version }
 */
export function encryptToken(
  plaintext: string,
  aad: string,
  version: number = CURRENT_KEY_VERSION,
): { enc: string; key_version: number } {
  const key = getKeyByVersion(version);
  const iv  = randomBytes(IV_LEN);

  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag(); // always 16 bytes for AES-GCM

  // Envelope: IV || AuthTag || Ciphertext
  const envelope = Buffer.concat([iv, tag, encrypted]);

  return {
    enc: envelope.toString('base64url'),
    key_version: version,
  };
}

// ============================================================
// DECRYPT
// ============================================================

/**
 * decryptToken — Decrypt an AES-256-GCM envelope.
 *
 * Throws if:
 *   - envelope is too short (corrupted)
 *   - AAD does not match (wrong integration_id)
 *   - auth tag fails (tampered ciphertext or wrong key)
 *   - key version not found in env
 *
 * NEVER includes plaintext, key material, or full ciphertext in error messages.
 *
 * @param enc         base64url envelope from encryptToken.
 * @param aad         Must match exactly the aad used during encryption (integration_id).
 * @param key_version Key version recorded alongside the ciphertext (from integrations_secrets).
 * @returns           Decrypted plaintext token string.
 */
export function decryptToken(
  enc: string,
  aad: string,
  key_version: number,
): string {
  const key      = getKeyByVersion(key_version);
  const envelope = Buffer.from(enc, 'base64url');

  if (envelope.length < IV_LEN + TAG_LEN) {
    throw new Error('[crypto] Decryption failed: envelope too short (corrupted data).');
  }

  const iv         = envelope.subarray(0, IV_LEN);
  const tag        = envelope.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = envelope.subarray(IV_LEN + TAG_LEN);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);

  try {
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    // Generic error: do NOT include ciphertext, key_version hint, or aad in message.
    throw new Error('[crypto] Decryption failed: authentication tag mismatch. '
      + 'Possible causes: wrong AAD, wrong key version, or tampered ciphertext.');
  }
}
