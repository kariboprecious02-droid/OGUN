/**
 * BullMQ queue + worker wiring.
 *
 * Ogun has two recurring background jobs:
 *   - `poller-tick`        — runs every 5 seconds, advances the
 *                           collection/payout poller state machine
 *   - `webhook-delivery`   — processes one pending delivery attempt,
 *                           using the retry schedule in webhook.service
 *
 * In production (env flag `OGUN_WORKERS=1`) we run BullMQ workers
 * backed by the Ogun Redis instance. In tests, and during local dev
 * when the flag is unset, the caller can still invoke tickPoller() and
 * dispatchDelivery() directly — the queues are lazy-initialized so
 * importing this module is cheap.
 */

import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import { config } from './config';
import { logger } from './logger';

const POLLER_QUEUE = 'ogun:poller';
const WEBHOOK_QUEUE = 'ogun:webhook-delivery';

type Handles = {
  pollerQueue: Queue;
  webhookQueue: Queue;
  pollerWorker: Worker;
  webhookWorker: Worker;
  pollerEvents: QueueEvents;
  webhookEvents: QueueEvents;
};

let handles: Handles | null = null;

function connection() {
  // BullMQ accepts a `connection` option that is a ioredis options object.
  // We pass the URL directly.
  return { connection: { url: config.redis.url } as { url: string } };
}

export async function startWorkers(): Promise<void> {
  if (handles) return;
  const { tickPoller } = await import('@/modules/polling/polling.service');
  const { dispatchDelivery } = await import('@/modules/webhook/webhook.service');

  const pollerQueue = new Queue(POLLER_QUEUE, connection());
  const webhookQueue = new Queue(WEBHOOK_QUEUE, connection());

  // Repeatable poller tick every `polling.intervalSeconds`
  await pollerQueue.add(
    'tick',
    {},
    {
      repeat: { every: config.polling.intervalSeconds * 1000 },
      jobId: 'poller-tick-repeat',
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );

  const pollerWorker = new Worker<unknown, void>(
    POLLER_QUEUE,
    async () => {
      await tickPoller();
    },
    connection(),
  );
  pollerWorker.on('failed', (_job, err) => logger.error({ err }, 'poller worker job failed'));

  const webhookWorker = new Worker<{ delivery_id: string }, void>(
    WEBHOOK_QUEUE,
    async (job: Job<{ delivery_id: string }>) => {
      await dispatchDelivery(job.data.delivery_id);
    },
    connection(),
  );
  webhookWorker.on('failed', (_job, err) =>
    logger.error({ err }, 'webhook worker job failed'),
  );

  const pollerEvents = new QueueEvents(POLLER_QUEUE, connection());
  const webhookEvents = new QueueEvents(WEBHOOK_QUEUE, connection());

  handles = { pollerQueue, webhookQueue, pollerWorker, webhookWorker, pollerEvents, webhookEvents };
  logger.info('bullmq workers started');
}

/**
 * Enqueue a webhook delivery for the worker to dispatch. Used by
 * webhook.service.emitEvent in worker mode. When workers aren't
 * running the caller falls back to the in-process dispatcher.
 */
export async function enqueueWebhookDelivery(deliveryId: string): Promise<void> {
  if (!handles) return; // workers not started; caller uses setInterval fallback
  await handles.webhookQueue.add(
    'deliver',
    { delivery_id: deliveryId },
    { removeOnComplete: 1000, removeOnFail: 1000, attempts: 1 },
  );
}

export async function stopWorkers(): Promise<void> {
  if (!handles) return;
  const { pollerQueue, webhookQueue, pollerWorker, webhookWorker, pollerEvents, webhookEvents } =
    handles;
  await pollerWorker.close();
  await webhookWorker.close();
  await pollerEvents.close();
  await webhookEvents.close();
  await pollerQueue.close();
  await webhookQueue.close();
  handles = null;
}

export function isWorkerModeEnabled(): boolean {
  return process.env.OGUN_WORKERS === '1';
}

export function workersRunning(): boolean {
  return handles !== null;
}
