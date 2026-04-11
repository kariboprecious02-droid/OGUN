import { z, ZodError, ZodSchema } from 'zod';
import { OgunError } from '@/infra/errors';

/**
 * Parse a request body against a Zod schema, re-throwing as an OgunError
 * with structured `details` so the API returns the standard envelope.
 */
export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw OgunError.invalidRequest('Request body failed validation', {
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    throw err;
  }
}

export function parseQuery<T>(schema: ZodSchema<T>, query: unknown): T {
  try {
    return schema.parse(query);
  } catch (err) {
    if (err instanceof ZodError) {
      throw OgunError.invalidRequest('Query parameters failed validation', {
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    throw err;
  }
}

export const positiveInt = z.coerce.number().int().positive();

const paginationBase = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
};

export const pagination = z.object(paginationBase);

/**
 * Parse a pagination-extended query and guarantee numeric page/limit
 * (Zod `.default()` output widens to `number | undefined` when extended).
 */
export function resolvePagination(q: { page?: number; limit?: number }): {
  page: number;
  limit: number;
} {
  return { page: q.page ?? 1, limit: q.limit ?? 50 };
}
