import { getRedis } from './redis';
import { sha256Hex } from './crypto';
import { config } from './config';
import { OgunError } from './errors';

/**
 * Idempotency-Key handler per Execution Spec §1.1 & §10.1.
 *
 *   Same key + same body  -> return cached response
 *   Same key + diff body  -> 409 idempotency_conflict
 *
 * Stored in Redis with a configurable TTL (default 24h).
 */

const PREFIX = 'ogun:idem:';

type Cached = {
  bodyHash: string;
  responseBody: unknown;
  httpStatus: number;
};

function keyFor(merchantId: string, idempotencyKey: string, route: string): string {
  return `${PREFIX}${merchantId}:${route}:${idempotencyKey}`;
}

export async function lookupIdempotent(
  merchantId: string,
  idempotencyKey: string,
  route: string,
  requestBody: unknown,
): Promise<{ cached: Cached } | null> {
  const redis = getRedis();
  const raw = await redis.get(keyFor(merchantId, idempotencyKey, route));
  if (!raw) return null;
  const cached: Cached = JSON.parse(raw);
  const incomingHash = sha256Hex(JSON.stringify(requestBody ?? {}));
  if (cached.bodyHash !== incomingHash) {
    throw OgunError.idempotencyConflict();
  }
  return { cached };
}

export async function storeIdempotent(
  merchantId: string,
  idempotencyKey: string,
  route: string,
  requestBody: unknown,
  responseBody: unknown,
  httpStatus: number,
): Promise<void> {
  const redis = getRedis();
  const value: Cached = {
    bodyHash: sha256Hex(JSON.stringify(requestBody ?? {})),
    responseBody,
    httpStatus,
  };
  await redis.set(
    keyFor(merchantId, idempotencyKey, route),
    JSON.stringify(value),
    'EX',
    config.platform.idempotencyTtlSeconds,
  );
}
