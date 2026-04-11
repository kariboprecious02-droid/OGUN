import crypto from 'node:crypto';

/**
 * HMAC-SHA256 signing utilities used by outbound webhook dispatch
 * (X-Ogun-Signature) and inbound provider signature verification.
 */
export function hmacSha256Hex(payload: string | Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function sha256Hex(payload: string | Buffer): string {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Timing-safe string comparison.
 */
export function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Generate a cryptographically random secret key for merchant credentials.
 * Format: `<prefix>_<env>_<random-base62>`.
 */
export function generateApiKey(prefix: 'pk' | 'sk' | 'whsec', env: 'test' | 'live'): string {
  const raw = crypto.randomBytes(24).toString('base64url');
  return `${prefix}_${env}_${raw}`;
}

/**
 * Masked representation of a secret for display in dashboards/logs.
 */
export function maskKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 4)}***`;
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

/**
 * One-way hash used for API credential storage at rest.
 * Uses a platform-wide salt to defend against rainbow tables.
 */
export function hashApiKey(key: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(key).digest('hex');
}

/**
 * Reversible encryption for secrets we need to read back at runtime
 * (e.g. webhook endpoint secrets used to sign outbound payloads).
 *
 * AES-256-GCM with a random 12-byte IV per encryption, prefixed with
 * a version byte so we can rotate algorithms in the future.
 *
 * The key is derived from the platform-wide signing salt via SHA-256.
 * In production this should come from KMS; MVP ships with a salt
 * derived from `OGUN_WEBHOOK_SIGNING_SALT`.
 */
const ENCRYPTION_VERSION = 1;

function deriveEncryptionKey(salt: string): Buffer {
  return crypto.createHash('sha256').update(`ogun-enc-v${ENCRYPTION_VERSION}:${salt}`).digest();
}

export function encryptSecret(plaintext: string, salt: string): string {
  const key = deriveEncryptionKey(salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Envelope format: v1.<base64url(iv)>.<base64url(tag)>.<base64url(ciphertext)>
  return [
    `v${ENCRYPTION_VERSION}`,
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join('.');
}

export function decryptSecret(envelope: string, salt: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== `v${ENCRYPTION_VERSION}`) {
    throw new Error('Invalid secret envelope');
  }
  const key = deriveEncryptionKey(salt);
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString('utf8');
}
