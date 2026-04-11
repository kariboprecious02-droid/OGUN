import type { Request, Response, NextFunction } from 'express';
import { OgunError } from '@/infra/errors';
import { authenticateBearer } from '@/modules/auth/auth.service';

/**
 * Require a Bearer `sk_*` or `pk_*` credential. Secret-key-only routes
 * can additionally call `requireSecretKey(req)` inside the handler.
 */
export function authenticate() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.header('Authorization');
      if (!header) throw OgunError.unauthorized('Missing Authorization header');
      const [scheme, token] = header.split(' ');
      if (scheme?.toLowerCase() !== 'bearer' || !token) {
        throw OgunError.unauthorized('Authorization must be Bearer <key>');
      }
      const principal = await authenticateBearer(token.trim());
      req.ogunContext.principal = principal;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireSecretKey(req: Request): void {
  const p = req.ogunContext.principal;
  if (!p || p.keyType !== 'secret') {
    throw OgunError.forbidden('Secret key required');
  }
}
