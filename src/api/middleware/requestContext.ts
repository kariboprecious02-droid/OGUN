import type { Request, Response, NextFunction } from 'express';
import { newId } from '@/infra/ids';
import { runWithContext } from '@/infra/requestContext';

declare module 'express-serve-static-core' {
  interface Request {
    ogunContext: {
      requestId: string;
      correlationId: string;
      idempotencyKey?: string;
      principal?: import('@/modules/auth/auth.service').AuthenticatedPrincipal;
    };
  }
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = newId('request');
  const correlationId = (req.header('X-Correlation-Id') as string | undefined) ?? requestId;
  const idempotencyKey = req.header('Idempotency-Key') as string | undefined;
  req.ogunContext = { requestId, correlationId, idempotencyKey };
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Correlation-Id', correlationId);
  runWithContext({ request_id: requestId, correlation_id: correlationId }, () => next());
}
