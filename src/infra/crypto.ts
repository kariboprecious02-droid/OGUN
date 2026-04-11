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
