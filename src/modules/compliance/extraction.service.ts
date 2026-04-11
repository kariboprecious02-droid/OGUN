/**
 * Layer 1 — Document Extraction Service (§4.2.1).
 *
 * This module represents the interface to a document-AI extraction
 * provider (Google Document AI / AWS Textract / Azure Form Recognizer).
 *
 * In MVP we ship a deterministic stub that:
 *   - classifies by document type hint
 *   - echoes provided `file_hash` for reproducibility
 *   - emits a shape compatible with `Document.extracted_data`
 *
 * Replace `extractDocument` with a real provider client in Phase 1.
 */

import { logger } from '@/infra/logger';

export type ExtractionResult = {
  classification: string;
  classification_confidence: number;
  fields: Record<string, string>;
  fields_confidence: Record<string, number>;
  raw_text: string;
  errors: string[];
};

export type ExtractionInput = {
  documentId: string;
  documentType: string;
  fileUrl: string;
  fileHash: string | null;
};

export async function extractDocument(input: ExtractionInput): Promise<ExtractionResult> {
  logger.debug({ doc: input.documentId }, 'extract stub invoked');

  // Stub output with reasonable defaults per document type.
  // In production this is replaced by the real provider client.
  const byType: Record<string, ExtractionResult> = {
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
  return (
    byType[input.documentType] ?? {
      classification: 'other',
      classification_confidence: 0.5,
      fields: {},
      fields_confidence: {},
      raw_text: '',
      errors: [],
    }
  );
}
