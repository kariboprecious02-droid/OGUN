import type { Request, Response, NextFunction } from 'express';
import { OgunError } from '@/infra/errors';
import { lookupIdempotent, storeIdempotent } from '@/infra/idempotency';

/**
 * Idempotency-Key middleware for POST routes. If the request was already
 * handled, serves the cached response immediately. Otherwise, wraps
 * res.json to persist the outgoing response under the key.
 *
 * Per Execution Spec §10.1:
 *   Same key + same body  -> cached response
 *   Same key + diff body  -> 409 idempotency_conflict
 */
export function idempotency(route: string, { required = false }: { required?: boolean } = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = req.ogunContext.idempotencyKey;
      const principal = req.ogunContext.principal;

      if (!key) {
        if (required) {
          throw OgunError.invalidRequest('Idempotency-Key header is required for this endpoint');
        }
        return next();
      }

      if (!principal) {
        // Auth must run before idempotency
        throw OgunError.unauthorized();
      }

      const hit = await lookupIdempotent(principal.merchantId, key, route, req.body);
      if (hit) {
        res.status(hit.cached.httpStatus).json(hit.cached.responseBody);
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        const status = res.statusCode ?? 200;
        // Fire-and-forget store
        void storeIdempotent(principal.merchantId, key, route, req.body, body, status).catch(() => void 0);
        return originalJson(body);
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
