/**
 * Ogun standard response envelope (§11.2).
 *
 *   Success: { status: "success", data, meta }
 *   Error:   { status: "error",   error, meta }
 */
export type OgunMeta = {
  request_id: string;
  idempotency_key?: string;
  [k: string]: unknown;
};

export type OgunSuccessResponse<T> = {
  status: 'success';
  data: T;
  meta: OgunMeta;
};

export type OgunErrorResponse = {
  status: 'error';
  error: { code: string; message: string; details?: Record<string, unknown> };
  meta: OgunMeta;
};

export function success<T>(data: T, meta: OgunMeta): OgunSuccessResponse<T> {
  return { status: 'success', data, meta };
}

export function paginated<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
  requestId: string,
): OgunSuccessResponse<T[]> {
  return {
    status: 'success',
    data: items,
    meta: { request_id: requestId, page, limit, total },
  };
}
