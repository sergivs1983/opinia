/**
 * crypto.test.ts — Unit tests for AES-256-GCM token encryption.
 *
 * Contracts verified:
 *   ✓ Round-trip: encrypt → decrypt returns original plaintext
 *   ✓ AAD mismatch → throws (GCM auth tag failure)
 *   ✓ Tampered ciphertext → throws (GCM auth tag failure)
 *   ✓ Key rotation: V2 encrypts/decrypts independently of V1
 *   ✓ V1 ciphertext rejected by V2 key (wrong key = auth fail)
 *   ✓ Missing key version → throws immediately (fail-fast)
 *   ✓ Random IV: two encryptions of same plaintext differ
 *   ✓ Truncated envelope → throws
 *   ✓ Empty plaintext round-trips correctly
 *   ✓ Unicode token round-trips correctly
 *
 * Run: npx tsx src/__tests__/crypto.test.ts
 *      node --import tsx src/__tests__/crypto.test.ts
 */

// ── Test key setup (32 bytes of test data — NEVER use in production) ─────────
// V1: 32 bytes of 0x00
process.env.OAUTH_ENCRYPTION_KEY_V1 = '0'.repeat(64);
// V2: 32 bytes of 0x11
process.env.OAUTH_ENCRYPTION_KEY_V2 = '1'.repeat(64);

import { encryptToken, decryptToken, CURRENT_KEY_VERSION, getKeyByVersion } from '../lib/server/crypto';

// ── Test helpers ──────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log('  ✅', label);
    pass++;
  } else {
    console.error('  ❌', label);
    fail++;
  }
}

function assertThrows(label: string, fn: () => unknown): void {
  try {
    fn();
    console.error('  ❌', label, '(did not throw)');
    fail++;
  } catch {
    console.log('  ✅', label);
    pass++;
  }
}

async function assertThrowsAsync(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.error('  ❌', label, '(did not throw)');
    fail++;
  } catch {
    console.log('  ✅', label);
    pass++;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────
const INTEGRATION_A = '550e8400-e29b-41d4-a716-446655440001';
const INTEGRATION_B = '550e8400-e29b-41d4-a716-446655440002';
const PLAIN_TOKEN   = 'ya29.A0ARrdaM-real-looking-oauth-token-string';

// ─────────────────────────────────────────────────────────────────────────────
async function run() {

  // ── 1) ROUND-TRIP ──────────────────────────────────────────────────────────
  console.log('\n=== 1) ROUND-TRIP ===');
  {
    const { enc, key_version } = encryptToken(PLAIN_TOKEN, INTEGRATION_A);
    assert('key_version equals CURRENT_KEY_VERSION', key_version === CURRENT_KEY_VERSION);
    assert('enc is a non-empty string', typeof enc === 'string' && enc.length > 0);
    assert('enc is base64url (no +, /, =)', /^[A-Za-z0-9_-]+$/.test(enc));
    // base64url of (12 + 16 + token_bytes) bytes — token is 46 chars UTF-8
    assert('enc length reasonable (>= 38 base64url chars)', enc.length >= 38);

    const decrypted = decryptToken(enc, INTEGRATION_A, key_version);
    assert('decrypted matches original plaintext', decrypted === PLAIN_TOKEN);
  }

  // ── 2) AAD MISMATCH → THROWS ───────────────────────────────────────────────
  console.log('\n=== 2) AAD MISMATCH → THROWS ===');
  {
    const { enc, key_version } = encryptToken(PLAIN_TOKEN, INTEGRATION_A);
    assertThrows('wrong AAD (different integration_id) throws', () => {
      decryptToken(enc, INTEGRATION_B, key_version);
    });
    assertThrows('empty string AAD throws', () => {
      decryptToken(enc, '', key_version);
    });
  }

  // ── 3) TAMPERED CIPHERTEXT → THROWS ───────────────────────────────────────
  console.log('\n=== 3) TAMPERED CIPHERTEXT → THROWS ===');
  {
    const { enc, key_version } = encryptToken(PLAIN_TOKEN, INTEGRATION_A);
    // Flip a char in the middle of the envelope (past IV and AuthTag)
    const tampered = enc.slice(0, enc.length - 8) + 'XXXXXXXX';
    assertThrows('tampered ciphertext throws', () => {
      decryptToken(tampered, INTEGRATION_A, key_version);
    });

    // Flip a character in the middle of the envelope (reliably hits ciphertext bytes)
    const mid = Math.floor(enc.length / 2);
    const midFlipped = enc.slice(0, mid) + (enc[mid] === 'A' ? 'B' : 'A') + enc.slice(mid + 1);
    assertThrows('mid-ciphertext single-char flip throws', () => {
      decryptToken(midFlipped, INTEGRATION_A, key_version);
    });
  }

  // ── 4) KEY ROTATION: V2 ────────────────────────────────────────────────────
  console.log('\n=== 4) KEY ROTATION: V2 ===');
  {
    const { enc: enc2, key_version: kv2 } = encryptToken(PLAIN_TOKEN, INTEGRATION_A, 2);
    assert('V2 encryption returns key_version=2', kv2 === 2);

    const dec2 = decryptToken(enc2, INTEGRATION_A, 2);
    assert('V2 decrypted matches plaintext', dec2 === PLAIN_TOKEN);

    // V1 ciphertext with V2 key → wrong key = auth tag failure
    const { enc: enc1 } = encryptToken(PLAIN_TOKEN, INTEGRATION_A, 1);
    assertThrows('V1 ciphertext rejects V2 key', () => {
      decryptToken(enc1, INTEGRATION_A, 2);
    });

    // V2 ciphertext with V1 key → same
    assertThrows('V2 ciphertext rejects V1 key', () => {
      decryptToken(enc2, INTEGRATION_A, 1);
    });
  }

  // ── 5) MISSING KEY VERSION → FAIL-FAST ───────────────────────────────────
  console.log('\n=== 5) MISSING KEY VERSION → FAIL-FAST ===');
  {
    assertThrows('encryptToken with non-existent version throws', () => {
      encryptToken(PLAIN_TOKEN, INTEGRATION_A, 99);
    });

    assertThrows('decryptToken with non-existent version throws', () => {
      // V99 key doesn't exist
      decryptToken('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', INTEGRATION_A, 99);
    });

    assertThrows('getKeyByVersion with missing env var throws', () => {
      getKeyByVersion(99);
    });
  }

  // ── 6) BAD KEY FORMAT → FAIL-FAST ────────────────────────────────────────
  console.log('\n=== 6) BAD KEY FORMAT → FAIL-FAST ===');
  {
    const orig = process.env.OAUTH_ENCRYPTION_KEY_V1;

    process.env.OAUTH_ENCRYPTION_KEY_V1 = 'tooshort';
    assertThrows('16-char hex key (8 bytes) throws — wrong size', () => {
      getKeyByVersion(1);
    });

    process.env.OAUTH_ENCRYPTION_KEY_V1 = orig; // restore
    assert('valid 64-char hex key passes validation', (() => {
      try { getKeyByVersion(1); return true; } catch { return false; }
    })());
  }

  // ── 7) RANDOM IV: same plaintext → different ciphertext ──────────────────
  console.log('\n=== 7) RANDOM IV: same plaintext → different ciphertext ===');
  {
    const { enc: enc1 } = encryptToken(PLAIN_TOKEN, INTEGRATION_A);
    const { enc: enc2 } = encryptToken(PLAIN_TOKEN, INTEGRATION_A);
    assert('two encryptions of same token differ (random IV)', enc1 !== enc2);

    // But both decrypt correctly
    assert('first ciphertext decrypts correctly', decryptToken(enc1, INTEGRATION_A, 1) === PLAIN_TOKEN);
    assert('second ciphertext decrypts correctly', decryptToken(enc2, INTEGRATION_A, 1) === PLAIN_TOKEN);
  }

  // ── 8) TRUNCATED ENVELOPE → THROWS ────────────────────────────────────────
  console.log('\n=== 8) TRUNCATED ENVELOPE → THROWS ===');
  {
    // 27 bytes < IV_LEN(12) + TAG_LEN(16) = 28 minimum → "too short" error
    const tooShort = Buffer.alloc(27).toString('base64url');
    assertThrows('envelope < 28 bytes throws (too short)', () => {
      decryptToken(tooShort, INTEGRATION_A, 1);
    });

    // 28 bytes = IV+Tag only, zero ciphertext, all-zero IV/tag → auth tag failure
    const allZero28 = Buffer.alloc(28).toString('base64url');
    assertThrows('all-zero 28-byte envelope throws (bad auth tag)', () => {
      decryptToken(allZero28, INTEGRATION_A, 1);
    });

    // Empty string → 0 bytes → also too short
    assertThrows('empty base64url string throws', () => {
      decryptToken('', INTEGRATION_A, 1);
    });
  }

  // ── 9) EDGE CASES: empty plaintext, unicode ────────────────────────────────
  console.log('\n=== 9) EDGE CASES ===');
  {
    const emptyPlain = '';
    const { enc: emptyEnc, key_version } = encryptToken(emptyPlain, INTEGRATION_A);
    assert('empty string encrypts to non-empty envelope', emptyEnc.length > 0);
    assert('empty string round-trips', decryptToken(emptyEnc, INTEGRATION_A, key_version) === emptyPlain);

    const unicodePlain = 'ya29.こんにちは-世界-token-€£¥';
    const { enc: uniEnc, key_version: ukv } = encryptToken(unicodePlain, INTEGRATION_A);
    assert('unicode token round-trips', decryptToken(uniEnc, INTEGRATION_A, ukv) === unicodePlain);

    // Long token (512 chars)
    const longPlain = 'x'.repeat(512);
    const { enc: longEnc, key_version: lkv } = encryptToken(longPlain, INTEGRATION_A);
    assert('512-char token round-trips', decryptToken(longEnc, INTEGRATION_A, lkv) === longPlain);
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error('\n❌ Some tests failed.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed.');
  }
}

run().catch((e: unknown) => {
  console.error('Unexpected error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
