/**
 * Integration test harness.
 *
 * These tests hit a real Postgres + Redis and are gated by the
 * `RUN_INTEGRATION=1` env var so the default `npm test` stays pure-unit
 * and runs with no external dependencies.
 *
 *   npm test                 # unit only (45 fast tests)
 *   npm run test:integration # unit + integration (requires local DB)
 *
 * Env contract:
 *   RUN_INTEGRATION=1
 *   DATABASE_URL   pointing at a dedicated `ogun_test` database
 *   REDIS_URL      pointing at any Redis (usually db 1 for test isolation)
 *
 * The harness applies the migration once per file and truncates all
 * tables between tests. Redis is flushed between tests as well.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closePool } from '@/infra/db/pool';
import { getRedis, closeRedis } from '@/infra/redis';
import { drainAsync } from '@/infra/asyncTracker';

export const INTEGRATION_ENABLED = process.env.RUN_INTEGRATION === '1';

const MIGRATION_FILE = path.join(
  __dirname,
  '../infra/db/migrations/0001_initial_schema.sql',
);

/**
 * Apply the migration idempotently. Call from `beforeAll`.
 */
export async function setupIntegrationSchema(): Promise<void> {
  if (!INTEGRATION_ENABLED) return;
  const pool = getPool();
  const sql = readFileSync(MIGRATION_FILE, 'utf8');
  await pool.query(sql);
}

/**
 * Tear down pool + redis handles. Call from `afterAll`.
 * Drains in-flight fire-and-forget dispatches first so they don't
 * try to use closed handles.
 */
export async function teardownIntegration(): Promise<void> {
  if (!INTEGRATION_ENABLED) return;
  await drainAsync();
  try {
    await getRedis().flushdb();
  } catch {
    // ignore
  }
  await closeRedis();
  await closePool();
}

/**
 * Truncate all data tables and flush Redis. Call from `beforeEach`.
 * Drains in-flight fire-and-forget dispatches first so they don't
 * race with the truncate.
 */
export async function truncateAllTables(): Promise<void> {
  if (!INTEGRATION_ENABLED) return;
  await drainAsync();
  const pool = getPool();
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT LIKE '\\_ogun\\_%' ESCAPE '\\'`,
  );
  if (rows.length > 0) {
    const list = rows.map((r) => `"${r.tablename}"`).join(', ');
    await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  try {
    await getRedis().flushdb();
  } catch {
    // ignore
  }
}

/**
 * Jest helper that skips a test file entirely if integration mode isn't on.
 */
export const describeIntegration = (
  name: string,
  fn: (this: void) => void,
): void => {
  if (INTEGRATION_ENABLED) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (set RUN_INTEGRATION=1 to enable)`, fn);
  }
};
