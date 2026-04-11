import { OgunError, ErrorCode } from './errors';

describe('OgunError public envelope (§11.2)', () => {
  test('serializes as {status, error, meta}', () => {
    const e = OgunError.invalidRequest('bad body', { field: 'amount' });
    const json = e.toPublicJson('req_abc');
    expect(json).toEqual({
      status: 'error',
      error: { code: 'invalid_request', message: 'bad body', details: { field: 'amount' } },
      meta: { request_id: 'req_abc' },
    });
  });

  test('HTTP status codes per §10.2', () => {
    expect(OgunError.unauthorized().httpStatus).toBe(401);
    expect(OgunError.forbidden().httpStatus).toBe(403);
    expect(OgunError.notFound('X').httpStatus).toBe(404);
    expect(OgunError.idempotencyConflict().httpStatus).toBe(409);
    expect(new OgunError(ErrorCode.InsufficientPayoutBalance, 'x').httpStatus).toBe(422);
    expect(new OgunError(ErrorCode.ProviderTimeout, 'x').httpStatus).toBe(502);
    expect(new OgunError(ErrorCode.RateLimited, 'x').httpStatus).toBe(429);
  });
});
