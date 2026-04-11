/**
 * Google Document AI extraction adapter — §4.2.1.
 *
 * Wraps `@google-cloud/documentai` DocumentProcessorServiceClient. For
 * each Ogun compliance document type we call the configured processor:
 *
 *   certificate_of_registration → processorIdsByType.certificate_of_registration
 *                                 ||  defaultProcessorId
 *   tax_certificate             → processorIdsByType.tax_certificate || default
 *   director_id                 → processorIdsByType.director_id     || default
 *   bank_confirmation           → processorIdsByType.bank_confirmation || default
 *   other                       → defaultProcessorId (required)
 *
 * Document AI returns a `Document` proto with:
 *   - `text`: full extracted text
 *   - `entities`: array of {type, mentionText, confidence} we map to
 *     `fields` + `fields_confidence`
 *   - `textStyles` / `pages`: not consumed here, but available if you
 *     want richer layout-aware extraction later.
 *
 * Credentials are picked up from the standard Google Cloud chain:
 *   - GOOGLE_APPLICATION_CREDENTIALS  (path to JSON)
 *   - GOOGLE_APPLICATION_CREDENTIALS_JSON (inline JSON)
 *   - gcloud default application credentials
 *   - metadata server (GCE/GKE/Cloud Run)
 *
 * Failures are surfaced as errors on the result object; the
 * compliance pipeline continues processing the rest of the documents
 * so a transient Document AI outage doesn't block onboarding.
 */

import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import type { google } from '@google-cloud/documentai/build/protos/protos';
import { config } from '@/infra/config';
import { logger } from '@/infra/logger';
import {
  ExtractionAdapter,
  ExtractionInput,
  ExtractionResult,
  readDocumentBytes,
} from './extraction.service';

type IDocument = google.cloud.documentai.v1.IDocument;
type IEntity = google.cloud.documentai.v1.Document.IEntity;

export class GoogleDocumentAIAdapter implements ExtractionAdapter {
  readonly name = 'google_document_ai';
  private client: DocumentProcessorServiceClient | null = null;

  private getClient(): DocumentProcessorServiceClient {
    if (this.client) return this.client;
    // Honor GOOGLE_APPLICATION_CREDENTIALS_JSON as an inline credential
    // bundle (useful for container deployments where you don't want to
    // mount a file). Falls through to the default Google auth chain.
    const inline = config.documentAI.credentialsJson;
    if (inline) {
      try {
        const creds = JSON.parse(inline) as { client_email: string; private_key: string };
        this.client = new DocumentProcessorServiceClient({
          projectId: config.documentAI.projectId,
          credentials: {
            client_email: creds.client_email,
            private_key: creds.private_key,
          },
        });
        return this.client;
      } catch (err) {
        logger.error({ err }, 'failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON');
      }
    }
    this.client = new DocumentProcessorServiceClient({
      projectId: config.documentAI.projectId || undefined,
    });
    return this.client;
  }

  private resolveProcessorName(documentType: string): string {
    const perType =
      config.documentAI.processorIdsByType[documentType] ||
      config.documentAI.defaultProcessorId;
    if (!perType) {
      throw new Error(
        `No Document AI processor configured for type "${documentType}" and no default set`,
      );
    }
    return `projects/${config.documentAI.projectId}/locations/${config.documentAI.location}/processors/${perType}`;
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const processorName = this.resolveProcessorName(input.documentType);
    const { bytes, mimeType } = await readDocumentBytes(input.documentId);

    logger.info(
      {
        doc: input.documentId,
        type: input.documentType,
        processor: processorName,
        size: bytes.length,
      },
      'calling google document ai',
    );

    const client = this.getClient();
    const [response] = await client.processDocument({
      name: processorName,
      rawDocument: {
        content: bytes,
        mimeType,
      },
    });

    const doc = response.document as IDocument | null | undefined;
    if (!doc) {
      return {
        classification: input.documentType,
        classification_confidence: 0,
        fields: {},
        fields_confidence: {},
        raw_text: '',
        errors: ['Document AI returned no document'],
        adapter: this.name,
        processor_id: processorName,
      };
    }

    const mapped = mapDocumentAIResponse(doc, input.documentType);
    return { ...mapped, adapter: this.name, processor_id: processorName };
  }
}

/**
 * Pure function mapping a Google Document AI `Document` proto into
 * Ogun's `ExtractionResult` shape. Exported for unit testing without
 * hitting the live API.
 */
export function mapDocumentAIResponse(
  doc: IDocument,
  documentType: string,
): Omit<ExtractionResult, 'adapter' | 'processor_id'> {
  const fields: Record<string, string> = {};
  const fieldsConfidence: Record<string, number> = {};

  // Top-level `entities` are the primary structured output from
  // Document AI processors. Each entity has a `type`, `mentionText`,
  // and `confidence` we can surface directly.
  const entities: IEntity[] = (doc.entities as IEntity[] | undefined) ?? [];
  for (const ent of entities) {
    const key = normalizeFieldKey(ent.type ?? '');
    if (!key) continue;
    const value = ent.mentionText ?? ent.normalizedValue?.text ?? '';
    if (!value) continue;
    fields[key] = value;
    if (typeof ent.confidence === 'number') {
      fieldsConfidence[key] = round(ent.confidence);
    }
  }

  // Per-type post-processing: when the processor returns common field
  // names under different labels, normalize them to Ogun's canonical
  // names so the rules engine can compare directly.
  alias(fields, 'registration_id', 'registration_number');
  alias(fields, 'company', 'company_name');
  alias(fields, 'business_name', 'company_name');
  alias(fields, 'kra_pin', 'tax_id');
  alias(fields, 'pin_number', 'tax_id');
  alias(fields, 'pin', 'tax_id');
  alias(fields, 'identity_number', 'id_number');
  alias(fields, 'national_id', 'id_number');
  alias(fields, 'full_name', 'name');
  alias(fields, 'bank', 'bank_name');
  alias(fields, 'account', 'account_number');

  // Aggregate a classification confidence score: use the max entity
  // confidence as a proxy (Document AI doesn't return a single doc
  // classification on Form Parser — specialized processors do).
  let classificationConfidence = 0;
  for (const c of Object.values(fieldsConfidence)) {
    if (c > classificationConfidence) classificationConfidence = c;
  }
  // If no entities were found but we have raw text, fall back to a
  // low-confidence "other" classification.
  if (Object.keys(fields).length === 0) {
    classificationConfidence = 0.4;
  }

  return {
    classification: documentType,
    classification_confidence: classificationConfidence,
    fields,
    fields_confidence: fieldsConfidence,
    raw_text: doc.text ?? '',
    errors: [],
  };
}

function normalizeFieldKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function alias(
  fields: Record<string, string>,
  from: string,
  to: string,
): void {
  if (fields[from] && !fields[to]) {
    fields[to] = fields[from];
  }
}
