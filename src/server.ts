import { createApp } from './api/app';
import { config } from './infra/config';
import { logger } from './infra/logger';
import { tickPoller } from './modules/polling/polling.service';
import { dispatchDelivery } from './modules/webhook/webhook.service';
import { query } from './infra/db/pool';

async function main(): Promise<void> {
  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.ogunEnv }, 'Ogun server listening');
  });

  // Background workers — in production these run as separate processes
  // behind BullMQ, but for the modular monolith we schedule them here.

  // Collection poller tick — every `intervalSeconds` seconds
  const pollerInterval = setInterval(() => {
    tickPoller().catch((err) => logger.error({ err }, 'poller tick failed'));
  }, config.polling.intervalSeconds * 1000);

  // Webhook delivery worker — every 2 seconds scan for pending deliveries
  const webhookInterval = setInterval(async () => {
    try {
      const { rows } = await query<{ id: string }>(
        `SELECT id FROM webhook_deliveries
          WHERE delivery_status = 'pending'
            AND next_retry_at <= now()
          ORDER BY next_retry_at
          LIMIT 50`,
      );
      for (const d of rows) {
        await dispatchDelivery(d.id);
      }
    } catch (err) {
      logger.error({ err }, 'webhook dispatch tick failed');
    }
  }, 2_000);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    clearInterval(pollerInterval);
    clearInterval(webhookInterval);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
