import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from '@/infra/logger';
import { requestContextMiddleware } from './middleware/requestContext';
import { errorHandler } from './middleware/errorHandler';
import { metricsMiddleware } from './middleware/metrics';
import { renderMetrics } from '@/infra/metrics';
import merchantsRoutes from './routes/merchants.routes';
import documentsRoutes from './routes/documents.routes';
import collectionsRoutes from './routes/collections.routes';
import payoutsRoutes from './routes/payouts.routes';
import beneficiariesRoutes from './routes/beneficiaries.routes';
import walletsRoutes from './routes/wallets.routes';
import settlementsRoutes from './routes/settlements.routes';
import webhookEndpointsRoutes from './routes/webhookEndpoints.routes';
import adminRoutes from './routes/admin.routes';
import webhookRoutes from './routes/webhooks.routes';
import { initRegistry } from '@/modules/connectors/registry';

export function createApp(): express.Express {
  initRegistry();
  const app = express();

  // Webhook routes consume raw body — mount BEFORE global JSON middleware
  app.use('/v1', webhookRoutes);

  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(requestContextMiddleware);
  app.use(metricsMiddleware());

  // Health — responds at both /_health and /healthz for compatibility
  // with different deployment environments' startup probe configurations.
  const healthHandler = (_req: express.Request, res: express.Response): void => {
    res.json({ status: 'ok', service: 'ogun', version: '4.1.2' });
  };
  app.get('/_health', healthHandler);
  app.get('/healthz', healthHandler);

  // Admin auth probe — helps diagnose "Invalid admin secret" issues
  // without leaking the actual secret values. Returns booleans only.
  // Safe to expose: reveals only whether env vars are set, not their values.
  app.get('/_admin-probe', async (_req, res) => {
    const { config } = await import('@/infra/config');
    res.json({
      version: '4.1.2',
      admin_secret_is_default: config.platform.adminSecret === 'changeme-set-in-prod',
      admin_secret_from_env: !!process.env.OGUN_ADMIN_SECRET,
      admin_secret_length: config.platform.adminSecret.length,
      webhook_salt_is_default: config.platform.webhookSigningSalt === 'dev-salt',
      webhook_salt_from_env: !!process.env.OGUN_WEBHOOK_SIGNING_SALT,
      webhook_salt_length: config.platform.webhookSigningSalt.length,
    });
  });

  // Prometheus scrape endpoint
  app.get('/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(renderMetrics());
  });

  app.get('/v1', (_req, res) => {
    res.json({
      name: 'Ogun Payment Infrastructure Platform',
      version: '4.1.2',
      docs: 'https://docs.ogun.com',
    });
  });

  // Versioned routes
  app.use('/v1', merchantsRoutes);
  app.use('/v1', documentsRoutes);
  app.use('/v1', collectionsRoutes);
  app.use('/v1', payoutsRoutes);
  app.use('/v1', beneficiariesRoutes);
  app.use('/v1', walletsRoutes);
  app.use('/v1', settlementsRoutes);
  app.use('/v1', webhookEndpointsRoutes);
  app.use('/v1', adminRoutes);

  // 404
  app.use((req, res) => {
    res.status(404).json({
      status: 'error',
      error: { code: 'resource_not_found', message: `No route for ${req.method} ${req.path}` },
      meta: { request_id: req.ogunContext?.requestId ?? 'unknown' },
    });
  });

  app.use(errorHandler);

  return app;
}
