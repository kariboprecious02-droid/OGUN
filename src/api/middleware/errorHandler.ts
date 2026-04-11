import type { ErrorRequestHandler } from 'express';
import { OgunError, ErrorCode } from '@/infra/errors';
import { logger } from '@/infra/logger';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.ogunContext?.requestId ?? 'unknown';
  if (err instanceof OgunError) {
    res.status(err.httpStatus).json(err.toPublicJson(requestId));
    return;
  }
  logger.error({ err, requestId, path: req.path }, 'unhandled error');
  const wrapped = new OgunError(ErrorCode.InternalError, 'Internal server error');
  res.status(wrapped.httpStatus).json(wrapped.toPublicJson(requestId));
};
