import crypto from 'node:crypto';

export type PushSubscriptionRecord = {
  id?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushMessagePayload = {
  title: string;
  body: string;
  url: string;
  schedule_id?: string;
  biz_id?: string;
  platform?: 'instagram' | 'tiktok';
};

export type SendWebPushResult = {
  ok: boolean;
  status?: number;
  expired?: boolean;
  providerUnavailable?: boolean;
  reason?: string;
};

type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

function bufferToBase64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBuffer(input: string): Buffer {
  const trimmed = input.trim();
  if (!trimmed) return Buffer.alloc(0);
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : `${normalized}${'='.repeat(4 - padding)}`;
  return Buffer.from(padded, 'base64');
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return crypto.createHmac('sha256', salt).update(ikm).digest();
}

function hkdfExpand(prk: Buffer, info: Buffer, size: number): Buffer {
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  let counter = 1;

  while (Buffer.concat(blocks).length < size) {
    previous = crypto
      .createHmac('sha256', prk)
      .update(Buffer.concat([previous, info, Buffer.from([counter])]))
      .digest();
    blocks.push(previous);
    counter += 1;
  }

  return Buffer.concat(blocks).subarray(0, size);
}

function getVapidConfig(): VapidConfig | null {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || '').trim() || 'mailto:hello@opinia.app';

  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

function getVapidPrivateKey(config: VapidConfig): crypto.KeyObject {
  const publicKeyBytes = base64UrlToBuffer(config.publicKey);
  const privateKeyBytes = base64UrlToBuffer(config.privateKey);

  if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04 || privateKeyBytes.length !== 32) {
    throw new Error('invalid_vapid_keys');
  }

  const jwk: crypto.JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bufferToBase64Url(publicKeyBytes.subarray(1, 33)),
    y: bufferToBase64Url(publicKeyBytes.subarray(33)),
    d: bufferToBase64Url(privateKeyBytes),
    ext: true,
    key_ops: ['sign'],
  };

  return crypto.createPrivateKey({ key: jwk, format: 'jwk' });
}

function createVapidJwt(audience: string, config: VapidConfig): string {
  const header = bufferToBase64Url(Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const payload = bufferToBase64Url(Buffer.from(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: config.subject,
  })));

  const unsignedToken = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(unsignedToken), {
    key: getVapidPrivateKey(config),
    dsaEncoding: 'ieee-p1363',
  });

  return `${unsignedToken}.${bufferToBase64Url(signature)}`;
}

function buildEncryptedPayload(subscription: PushSubscriptionRecord, bodyJson: string): {
  encrypted: Buffer;
} {
  const clientPublicKey = base64UrlToBuffer(subscription.p256dh);
  const authSecret = base64UrlToBuffer(subscription.auth);

  if (clientPublicKey.length !== 65 || clientPublicKey[0] !== 0x04 || authSecret.length === 0) {
    throw new Error('invalid_subscription_keys');
  }

  const serverECDH = crypto.createECDH('prime256v1');
  serverECDH.generateKeys();

  const serverPublicKey = serverECDH.getPublicKey();
  const sharedSecret = serverECDH.computeSecret(clientPublicKey);

  const authPrk = hkdfExtract(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\u0000', 'utf8'),
    clientPublicKey,
    serverPublicKey,
  ]);
  const ikm = hkdfExpand(authPrk, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const cekPrk = hkdfExtract(salt, ikm);
  const contentEncryptionKey = hkdfExpand(cekPrk, Buffer.from('Content-Encoding: aes128gcm\u0000', 'utf8'), 16);
  const nonce = hkdfExpand(cekPrk, Buffer.from('Content-Encoding: nonce\u0000', 'utf8'), 12);

  const plaintext = Buffer.concat([Buffer.from(bodyJson, 'utf8'), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  const keyLength = Buffer.from([serverPublicKey.length]);

  const encrypted = Buffer.concat([
    salt,
    recordSize,
    keyLength,
    serverPublicKey,
    ciphertext,
    tag,
  ]);

  return { encrypted };
}

export function getWebPushPublicKey(): string | null {
  const config = getVapidConfig();
  return config?.publicKey || null;
}

export async function sendWebPush(params: {
  subscription: PushSubscriptionRecord;
  payload: PushMessagePayload;
  ttlSeconds?: number;
}): Promise<SendWebPushResult> {
  const config = getVapidConfig();
  if (!config) {
    return { ok: false, providerUnavailable: true, reason: 'missing_vapid_env' };
  }

  let endpoint: URL;
  try {
    endpoint = new URL(params.subscription.endpoint);
  } catch {
    return { ok: false, reason: 'invalid_endpoint' };
  }

  let encryptedPayload: Buffer;
  try {
    encryptedPayload = buildEncryptedPayload(params.subscription, JSON.stringify(params.payload)).encrypted;
  } catch {
    return { ok: false, reason: 'invalid_subscription' };
  }

  let jwt: string;
  try {
    jwt = createVapidJwt(`${endpoint.protocol}//${endpoint.host}`, config);
  } catch {
    return { ok: false, providerUnavailable: true, reason: 'invalid_vapid_signing' };
  }

  try {
    const response = await fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        TTL: String(params.ttlSeconds ?? 300),
        Urgency: 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: `vapid t=${jwt}, k=${config.publicKey}`,
      },
      body: new Uint8Array(encryptedPayload),
    });

    if (response.status === 200 || response.status === 201 || response.status === 202 || response.status === 204) {
      return { ok: true, status: response.status };
    }

    if (response.status === 404 || response.status === 410) {
      return { ok: false, status: response.status, expired: true, reason: 'subscription_gone' };
    }

    return { ok: false, status: response.status, reason: `push_${response.status}` };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}
