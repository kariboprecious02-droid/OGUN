/**
 * Layer 1 — Document Extraction Service (§4.2.1).
 *
 * Production implementation uses Google Document AI (§4.2.1 recommends
 * Document AI / Textract / Form Recognizer). The adapter pattern here
 * lets us swap providers cleanly.
 *
 * Adapter selection:
 *   1. GoogleDocumentAIAdapter — chosen when `GOOGLE_DOCUMENTAI_PROJECT_ID`
 *      and at least one processor ID are set.
 *   2. StubExtractionAdapter — deterministic fallback used in tests,
 *      sandbox without credentials, and local development.
 *
 * Both adapters emit the same `ExtractionResult` shape so the rest of
 * the compliance pipeline (rules engine + reasoning LLM) is oblivious
 * to the choice.
 */

import { logger } from '@/infra/logger';
import { config } from '@/infra/config';
import { getStorage } from '@/infra/storage';
import { findDocument } from '@/modules/document/document.repository';
import { GoogleDocumentAIAdapter } from './googleDocumentAI';

export type ExtractionResult = {
  classification: string;
  classification_confidence: number;
  fields: Record<string, string>;
  fields_confidence: Record<string, number>;
  raw_text: string;
  errors: string[];
  // Metadata for auditability — which adapter produced this result.
  adapter: string;
  processor_id?: string;
};

export type ExtractionInput = {
  documentId: string;
  documentType: string;
  fileUrl: string;
  fileHash: string | null;
};

/**
 * Adapter contract every extraction provider must implement.
 */
export interface ExtractionAdapter {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

/* ---------- Deterministic stub ---------- */

export class StubExtractionAdapter implements ExtractionAdapter {
  readonly name = 'stub';

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    logger.debug({ doc: input.documentId, type: input.documentType }, 'stub extract invoked');
    const byType: Record<string, Omit<ExtractionResult, 'adapter'>> = {
      certificate_of_registration: {
        classification: 'certificate_of_registration',
        classification_confidence: 0.92,
        fields: { company_name: '', registration_number: '' },
        fields_confidence: { company_name: 0.9, registration_number: 0.9 },
        raw_text: '',
        errors: [],
      },
      tax_certificate: {
        classification: 'tax_certificate',
        classification_confidence: 0.9,
        fields: { tax_id: '', company_name: '' },
        fields_confidence: { tax_id: 0.88, company_name: 0.85 },
        raw_text: '',
        errors: [],
      },
      director_id: {
        classification: 'director_id',
        classification_confidence: 0.82,
        fields: { name: '', id_number: '' },
        fields_confidence: { name: 0.78, id_number: 0.85 },
        raw_text: '',
        errors: [],
      },
      bank_confirmation: {
        classification: 'bank_confirmation',
        classification_confidence: 0.88,
        fields: { bank_name: '', account_number: '' },
        fields_confidence: { bank_name: 0.9, account_number: 0.92 },
        raw_text: '',
        errors: [],
      },
    };
    const base =
      byType[input.documentType] ?? {
        classification: 'other',
        classification_confidence: 0.5,
        fields: {},
        fields_confidence: {},
        raw_text: '',
        errors: [],
      };
    return { ...base, adapter: this.name };
  }
}

/* ---------- Adapter selection ---------- */

let adapter: ExtractionAdapter | null = null;

function isGoogleDocumentAIConfigured(): boolean {
  if (!config.documentAI.projectId) return false;
  const processors = config.documentAI.processorIdsByType;
  const hasDefault = Boolean(config.documentAI.defaultProcessorId);
  const hasAny = Object.values(processors).some((v) => v);
  return hasDefault || hasAny;
}

export function getExtractionAdapter(): ExtractionAdapter {
  if (adapter) return adapter;
  if (isGoogleDocumentAIConfigured()) {
    adapter = new GoogleDocumentAIAdapter();
    logger.info(
      {
        project: config.documentAI.projectId,
        location: config.documentAI.location,
      },
      'extraction adapter = google document ai',
    );
  } else {
    adapter = new StubExtractionAdapter();
    logger.info('extraction adapter = deterministic stub (GOOGLE_DOCUMENTAI_PROJECT_ID unset)');
  }
  return adapter;
}

/**
 * Test hook — force a specific adapter.
 */
export function setExtractionAdapter(next: ExtractionAdapter | null): void {
  adapter = next;
}

/**
 * Public extraction entry point used by the compliance pipeline.
 * Fetches the raw document bytes from storage, runs the adapter,
 * and returns a normalized result. Errors are surfaced as an
 * `errors` array entry so the compliance service can continue
 * processing the rest of the documents.
 */
export async function extractDocument(input: ExtractionInput): Promise<ExtractionResult> {
  const selected = getExtractionAdapter();
  try {
    const result = await selected.extract(input);
    return { ...result, adapter: result.adapter ?? selected.name };
  } catch (err) {
    logger.error(
      { err, doc: input.documentId, adapter: selected.name },
      'extraction adapter failed; returning error result',
    );
    return {
      classification: input.documentType,
      classification_confidence: 0,
      fields: {},
      fields_confidence: {},
      raw_text: '',
      errors: [(err as Error).message],
      adapter: selected.name,
    };
  }
}

/**
 * Fetch the raw bytes + MIME type of a document from the storage
 * adapter. Used by extraction adapters that need to send bytes over
 * the wire (Document AI, Textract, etc.).
 */
export async function readDocumentBytes(
  documentId: string,
): Promise<{ bytes: Buffer; mimeType: string; documentType: string }> {
  const row = await findDocument(documentId);
  if (!row) throw new Error(`Document ${documentId} not found`);

  // The stored `file_url` is the storage key prefixed by the scheme
  // returned by putObject (e.g. `file:///.../merchants/.../cor.pdf`).
  // We strip the scheme and derive the storage key.
  const key = deriveStorageKey(row.file_url);
  const storage = getStorage();
  const stream = await storage.getObjectStream(key);

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const bytes = Buffer.concat(chunks);
  // Infer mime type from extension; production should store it on upload.
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const mimeType =
    ext === 'pdf'
      ? 'application/pdf'
      : ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : 'application/octet-stream';
  return { bytes, mimeType, documentType: row.type };
}

function deriveStorageKey(fileUrl: string): string {
  // Local adapter format: "file:///absolute/path/to/.ogun-storage/<key>"
  const fileMatch = /^file:\/\/(.*)$/.exec(fileUrl);
  if (fileMatch) {
    const absolute = fileMatch[1];
    const idx = absolute.indexOf('.ogun-storage/');
    if (idx >= 0) return absolute.slice(idx + '.ogun-storage/'.length);
    return absolute;
  }
  // S3 adapter format (future): "s3://bucket/key"
  const s3Match = /^s3:\/\/[^/]+\/(.*)$/.exec(fileUrl);
  if (s3Match) return s3Match[1];
  return fileUrl;
}
