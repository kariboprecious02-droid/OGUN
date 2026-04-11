/**
 * Document storage abstraction — Execution Spec §2.3 / §4.2.
 *
 * Defines an object-store interface with two ready adapters:
 *   - `LocalStorageAdapter`   — writes under `.ogun-storage/`, default in dev
 *   - `S3StorageAdapter`      — stub that throws until an SDK is wired
 *
 * The adapter is chosen at process startup via `S3_BUCKET` env var.
 * Swapping to real S3 is one file change + `aws-sdk` install; no module
 * outside this file needs to know.
 */

import { createReadStream, createWriteStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { config } from './config';
import { logger } from './logger';

export type StoredObjectMeta = {
  key: string;
  url: string;
  size: number;
  sha256: string;
  content_type: string;
};

export interface StorageAdapter {
  readonly name: string;
  putObject(input: {
    key: string;
    body: Buffer | Readable;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<StoredObjectMeta>;
  getObjectStream(key: string): Promise<Readable>;
  getPresignedUrl(key: string, ttlSeconds?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

/* ---------- Local filesystem adapter (dev default) ---------- */

const LOCAL_ROOT = path.resolve(process.cwd(), '.ogun-storage');

class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local';

  async putObject(input: {
    key: string;
    body: Buffer | Readable;
    contentType: string;
  }): Promise<StoredObjectMeta> {
    const dest = path.join(LOCAL_ROOT, input.key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });

    const hash = crypto.createHash('sha256');
    let size = 0;

    if (Buffer.isBuffer(input.body)) {
      hash.update(input.body);
      size = input.body.length;
      await fsp.writeFile(dest, input.body);
    } else {
      const out = createWriteStream(dest);
      const tee = new Readable({
        read() {
          /* noop */
        },
      });
      // Hash + write by consuming the stream once
      await pipeline(async function* () {
        for await (const chunk of input.body as Readable) {
          const buf = chunk as Buffer;
          hash.update(buf);
          size += buf.length;
          yield buf;
        }
      }, out);
      void tee;
    }

    return {
      key: input.key,
      url: `file://${dest}`,
      size,
      sha256: hash.digest('hex'),
      content_type: input.contentType,
    };
  }

  async getObjectStream(key: string): Promise<Readable> {
    const source = path.join(LOCAL_ROOT, key);
    return createReadStream(source);
  }

  async getPresignedUrl(key: string): Promise<string> {
    // Local adapter just returns the file:// URL — suitable for dev.
    return `file://${path.join(LOCAL_ROOT, key)}`;
  }

  async deleteObject(key: string): Promise<void> {
    const target = path.join(LOCAL_ROOT, key);
    try {
      await fsp.unlink(target);
    } catch (err) {
      const error = err as { code?: string };
      if (error.code !== 'ENOENT') throw err;
    }
  }
}

/* ---------- S3 adapter stub ---------- */

class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3';
  async putObject(): Promise<StoredObjectMeta> {
    throw new Error('S3StorageAdapter not yet wired — install aws-sdk and implement');
  }
  async getObjectStream(): Promise<Readable> {
    throw new Error('S3StorageAdapter not yet wired');
  }
  async getPresignedUrl(): Promise<string> {
    throw new Error('S3StorageAdapter not yet wired');
  }
  async deleteObject(): Promise<void> {
    throw new Error('S3StorageAdapter not yet wired');
  }
}

/* ---------- Selection ---------- */

let adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (adapter) return adapter;
  if (config.s3.bucket && config.s3.accessKeyId && config.s3.secretAccessKey) {
    adapter = new S3StorageAdapter();
    logger.info({ bucket: config.s3.bucket }, 'storage adapter = s3');
  } else {
    adapter = new LocalStorageAdapter();
    logger.info({ root: LOCAL_ROOT }, 'storage adapter = local filesystem');
  }
  return adapter;
}

/** For tests: force a specific adapter. */
export function setStorageAdapter(next: StorageAdapter | null): void {
  adapter = next;
}
