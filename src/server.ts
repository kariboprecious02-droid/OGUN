import { createApp } from './api/app';
import { config } from './infra/config';
import { logger } from './infra/logger';
import { runMigrations } from './infra/db/migrate';
import { tickPoller } from './modules/polling/polling.service';
import { dispatchDelivery } from './modules/webhook/webhook.service';
import { tickSettlementScheduler } from './modules/settlement/scheduler';
import { tickRefundPoller } from './modules/polling/refundPoller';
import { fetchPaystackBanks } from './modules/connectors/paystackBanks';
import { query } from './infra/db/pool';
import { isWorkerModeEnabled, startWorkers, stopWorkers } from './infra/queue';

async function main(): Promise<void> {
  try {
    await runMigrations();
  } catch (err) {
    logger.error({ err }, 'migrations failed on startup — server will start but DB operations may fail');
  }

  await fetchPaystackBanks().catch(() => {});

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.ogunEnv }, 'Ogun server listening');
  });

  // Background workers.
  //
  // Two modes:
  //   - OGUN_WORKERS=1   → BullMQ-backed workers with repeatable jobs
  //   - default          → in-process setInterval fallback (suitable for
  //                        single-node dev; not safe across restarts)
  //
  // Both modes delegate to the same `tickPoller` / `dispatchDelivery`
  // functions so the behavior is identical; only the scheduling strategy
  // differs. Tests use the functions directly and skip both schedulers.

  let pollerInterval: NodeJS.Timeout | null = null;
  let webhookInterval: NodeJS.Timeout | null = null;
  let settlementInterval: NodeJS.Timeout | null = null;
  let refundPollerInterval: NodeJS.Timeout | null = null;

  if (isWorkerModeEnabled()) {
    await startWorkers();
  } else {
    pollerInterval = setInterval(() => {
      tickPoller().catch((err) => logger.error({ err }, 'poller tick failed'));
    }, config.polling.intervalSeconds * 1000);

    settlementInterval = setInterval(() => {
      tickSettlementScheduler().catch((err) =>
        logger.error({ err }, 'settlement scheduler tick failed'));
    }, 60_000);

    refundPollerInterval = setInterval(() => {
      tickRefundPoller().catch((err) =>
        logger.error({ err }, 'refund poller tick failed'));
    }, 60_000);

    webhookInterval = setInterval(async () => {
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
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    if (pollerInterval) clearInterval(pollerInterval);
    if (settlementInterval) clearInterval(settlementInterval);
    if (refundPollerInterval) clearInterval(refundPollerInterval);
    if (webhookInterval) clearInterval(webhookInterval);
    await stopWorkers();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
