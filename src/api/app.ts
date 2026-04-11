import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from '@/infra/logger';
import { requestContextMiddleware } from './middleware/requestContext';
import { errorHandler } from './middleware/errorHandler';
import merchantsRoutes from './routes/merchants.routes';
import collectionsRoutes from './routes/collections.routes';
import payoutsRoutes from './routes/payouts.routes';
import walletsRoutes from './routes/wallets.routes';
import settlementsRoutes from './routes/settlements.routes';
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

  // Health
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', service: 'ogun', version: '4.1.0' });
  });

  app.get('/v1', (_req, res) => {
    res.json({
      name: 'Ogun Payment Infrastructure Platform',
      version: '4.1.0',
      docs: 'https://docs.ogun.com',
    });
  });

  // Versioned routes
  app.use('/v1', merchantsRoutes);
  app.use('/v1', collectionsRoutes);
  app.use('/v1', payoutsRoutes);
  app.use('/v1', walletsRoutes);
  app.use('/v1', settlementsRoutes);
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
