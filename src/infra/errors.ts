/**
 * Ogun API error codes. Source: Execution Spec §10.2.
 * These are the ONLY error codes allowed in public API responses.
 */
export const ErrorCode = {
  InvalidRequest: 'invalid_request',
  Unauthorized: 'unauthorized',
  Forbidden: 'forbidden',
  ResourceNotFound: 'resource_not_found',
  IdempotencyConflict: 'idempotency_conflict',
  DuplicateRequest: 'duplicate_request',
  MerchantNotActive: 'merchant_not_active',
  SubMerchantNotActive: 'sub_merchant_not_active',
  MethodNotEnabled: 'method_not_enabled',
  InsufficientPayoutBalance: 'insufficient_payout_balance',
  CompliancePending: 'compliance_pending',
  ProviderTimeout: 'provider_timeout',
  ProviderRejected: 'provider_rejected',
  RateLimited: 'rate_limited',
  InternalError: 'internal_error',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

const DEFAULT_HTTP_STATUS: Record<ErrorCodeValue, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  resource_not_found: 404,
  idempotency_conflict: 409,
  duplicate_request: 409,
  merchant_not_active: 422,
  sub_merchant_not_active: 422,
  method_not_enabled: 422,
  insufficient_payout_balance: 422,
  compliance_pending: 422,
  provider_timeout: 502,
  provider_rejected: 502,
  rate_limited: 429,
  internal_error: 500,
};

export class OgunError extends Error {
  readonly code: ErrorCodeValue;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCodeValue, message: string, details?: Record<string, unknown>, httpStatus?: number) {
    super(message);
    this.name = 'OgunError';
    this.code = code;
    this.httpStatus = httpStatus ?? DEFAULT_HTTP_STATUS[code];
    this.details = details;
  }

  toPublicJson(requestId: string): Record<string, unknown> {
    return {
      status: 'error',
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
      meta: { request_id: requestId },
    };
  }

  static invalidRequest(message: string, details?: Record<string, unknown>): OgunError {
    return new OgunError(ErrorCode.InvalidRequest, message, details);
  }

  static unauthorized(message = 'Invalid API credentials'): OgunError {
    return new OgunError(ErrorCode.Unauthorized, message);
  }

  static forbidden(message = 'Insufficient permissions'): OgunError {
    return new OgunError(ErrorCode.Forbidden, message);
  }

  static notFound(resource: string, id?: string): OgunError {
    return new OgunError(ErrorCode.ResourceNotFound, `${resource}${id ? ` ${id}` : ''} not found`);
  }

  static idempotencyConflict(): OgunError {
    return new OgunError(
      ErrorCode.IdempotencyConflict,
      'Idempotency-Key reused with a different request body',
    );
  }

  static insufficientPayoutBalance(details: Record<string, unknown>): OgunError {
    return new OgunError(
      ErrorCode.InsufficientPayoutBalance,
      'Insufficient funds. Please fund your payout wallet and retry.',
      details,
    );
  }

  static merchantNotActive(merchantId: string): OgunError {
    return new OgunError(ErrorCode.MerchantNotActive, `Merchant ${merchantId} is not active`);
  }

  static subMerchantNotActive(id: string): OgunError {
    return new OgunError(ErrorCode.SubMerchantNotActive, `Sub-merchant ${id} is not active`);
  }

  static methodNotEnabled(method: string): OgunError {
    return new OgunError(ErrorCode.MethodNotEnabled, `Method ${method} is not enabled`);
  }

  static providerTimeout(provider: string): OgunError {
    return new OgunError(ErrorCode.ProviderTimeout, `Provider ${provider} timed out`);
  }

  static providerRejected(provider: string, reason: string): OgunError {
    return new OgunError(ErrorCode.ProviderRejected, `Provider ${provider} rejected: ${reason}`);
  }
}
