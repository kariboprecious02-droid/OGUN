import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getPool, closePool } from './pool';
import { logger } from '../logger';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS _ogun_migrations (
      id          serial PRIMARY KEY,
      name        varchar(255) NOT NULL UNIQUE,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await getPool().query<{ name: string }>(
    'SELECT name FROM _ogun_migrations ORDER BY id',
  );
  return new Set(rows.map((r) => r.name));
}

export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      logger.info({ migration: file }, 'skipping (already applied)');
      continue;
    }
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.info({ migration: file }, 'applying migration');
    await getPool().query(sql);
    await getPool().query('INSERT INTO _ogun_migrations (name) VALUES ($1)', [file]);
    logger.info({ migration: file }, 'applied');
  }

  logger.info('migrations complete');
}

// CLI entrypoint — run directly via `npm run migrate`
if (require.main === module) {
  runMigrations()
    .catch((err) => {
      logger.error({ err }, 'migration failed');
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
