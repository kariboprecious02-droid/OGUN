import { getRedis } from './redis';
import { OgunError, ErrorCode } from './errors';

/**
 * Simple fixed-window rate limiter keyed by an arbitrary string.
 * Used for sync endpoints (§12.3) which are rate-limited to 1 call
 * per collection/payout per minute to avoid DoSing provider APIs.
 *
 * Returns the number of seconds until the current window resets if
 * the caller is over budget, or `null` if they were under budget.
 */
export async function checkRateLimit(
  key: string,
  windowSeconds: number,
  maxCalls: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const redis = getRedis();
  const fullKey = `ogun:rl:${key}`;
  const count = await redis.incr(fullKey);
  if (count === 1) {
    await redis.expire(fullKey, windowSeconds);
  }
  if (count > maxCalls) {
    const ttl = await redis.ttl(fullKey);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Throw a 429 if the caller is over the limit.
 */
export async function enforceRateLimit(
  key: string,
  windowSeconds: number,
  maxCalls: number,
): Promise<void> {
  const result = await checkRateLimit(key, windowSeconds, maxCalls);
  if (!result.allowed) {
    throw new OgunError(
      ErrorCode.RateLimited,
      `Rate limit exceeded. Retry after ${result.retryAfterSeconds}s.`,
      { retry_after_seconds: result.retryAfterSeconds },
    );
  }
}
