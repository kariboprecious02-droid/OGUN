/**
 * Request-level metrics middleware. Emits:
 *   - ogun_http_requests_total{route, method, status}
 *   - ogun_http_duration_ms{route, method}
 */
import type { Request, Response, NextFunction } from 'express';
import { counter, histogram } from '@/infra/metrics';

function normalizeRoute(req: Request): string {
  // Use the Express route path (e.g. "/v1/collections/:id") so we
  // don't blow up cardinality with per-id metric series.
  const routePath = (req.route as { path?: string } | undefined)?.path;
  if (routePath) return `${req.baseUrl ?? ''}${routePath}`;
  // Fallback: drop obviously unique path segments.
  return req.path
    .split('/')
    .map((seg) =>
      /^[a-z]+_[0-9A-Za-z]{20,}$/.test(seg) || /^\d+$/.test(seg) ? ':id' : seg,
    )
    .join('/');
}

export function metricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = histogram('ogun_http_duration_ms', { method: req.method }).startTimer();
    res.on('finish', () => {
      timer.stop();
      const route = normalizeRoute(req);
      counter(
        'ogun_http_requests_total',
        {
          route,
          method: req.method,
          status: String(res.statusCode),
        },
        'Total HTTP requests processed by Ogun',
      ).inc();
    });
    next();
  };
}
