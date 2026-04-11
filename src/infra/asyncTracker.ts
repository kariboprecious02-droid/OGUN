/**
 * Tracks fire-and-forget background promises so that test harnesses
 * (and graceful shutdown) can wait for them to complete.
 *
 * The collection / payout orchestrators dispatch to providers
 * asynchronously to avoid blocking the HTTP response. In production
 * the outbox + worker pattern handles this cleanly; until that's
 * wired, we use this in-process tracker.
 *
 * Usage:
 *   trackAsync(dispatchToProvider(id));
 *   ...
 *   await drainAsync();
 */

import { logger } from './logger';

const inFlight = new Set<Promise<unknown>>();

/**
 * Register a background promise. The returned promise is added to the
 * in-flight set and removed when it settles.  Errors are logged (the
 * caller has already decided not to await the result).
 */
export function trackAsync<T>(promise: Promise<T>): Promise<T> {
  const wrapped = promise
    .catch((err) => {
      logger.error({ err }, 'tracked async task failed');
      return undefined as unknown as T;
    })
    .finally(() => {
      inFlight.delete(wrapped);
    });
  inFlight.add(wrapped);
  return promise;
}

/**
 * Wait for all currently-tracked background promises to settle.
 * New promises added during drain are awaited too (we loop until the
 * set is stable).  Caps at `timeoutMs` just in case.
 */
export async function drainAsync(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (inFlight.size > 0) {
    if (Date.now() - start > timeoutMs) {
      logger.warn({ remaining: inFlight.size }, 'drainAsync timed out');
      return;
    }
    const snapshot = Array.from(inFlight);
    await Promise.allSettled(snapshot);
  }
}

export function inFlightCount(): number {
  return inFlight.size;
}
