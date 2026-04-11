/**
 * Document service — Execution Spec §3.4 + §4.2.
 *
 * Accepts an uploaded file buffer, hashes it, writes it to the
 * configured storage adapter, and records a row in `documents`.
 * Upload is only allowed while the merchant is in draft /
 * changes_requested state (i.e. before or after a rejected review).
 */

import { getMerchant } from '@/modules/merchant/merchant.service';
import { MerchantStatus } from '@/modules/merchant/merchant.types';
import { OgunError } from '@/infra/errors';
import { newId } from '@/infra/ids';
import { logger } from '@/infra/logger';
import { getStorage } from '@/infra/storage';
import {
  insertDocument,
  findDocument,
  listDocumentsByMerchant,
  DocumentRow,
} from './document.repository';

export const SUPPORTED_DOCUMENT_TYPES = [
  'certificate_of_registration',
  'tax_certificate',
  'director_id',
  'proof_of_address',
  'bank_confirmation',
  'business_permit',
  'authority_letter',
  'other',
] as const;

export type DocumentType = (typeof SUPPORTED_DOCUMENT_TYPES)[number];

export type UploadDocumentInput = {
  merchant_id: string;
  sub_merchant_id?: string;
  type: DocumentType;
  original_name: string;
  content_type: string;
  body: Buffer;
};

const UPLOAD_ALLOWED_STATES: readonly string[] = [
  MerchantStatus.Draft,
  MerchantStatus.ChangesRequested,
  MerchantStatus.Submitted, // Allow replacing a doc post-submit but pre-AI review
];

export async function uploadDocument(input: UploadDocumentInput): Promise<DocumentRow> {
  const merchant = await getMerchant(input.merchant_id);
  if (!UPLOAD_ALLOWED_STATES.includes(merchant.status)) {
    throw OgunError.invalidRequest(
      `Cannot upload documents while merchant is in state ${merchant.status}`,
    );
  }
  if (!SUPPORTED_DOCUMENT_TYPES.includes(input.type)) {
    throw OgunError.invalidRequest(`Unsupported document type: ${input.type}`);
  }
  if (input.body.length === 0) {
    throw OgunError.invalidRequest('Empty document body');
  }
  if (input.body.length > 15 * 1024 * 1024) {
    throw OgunError.invalidRequest('Document exceeds 15 MB maximum');
  }

  const docId = newId('document');
  const key = `merchants/${merchant.id}/documents/${docId}-${sanitize(input.original_name)}`;
  const storage = getStorage();
  const stored = await storage.putObject({
    key,
    body: input.body,
    contentType: input.content_type,
    metadata: {
      merchant_id: merchant.id,
      document_type: input.type,
    },
  });

  const row = await insertDocument({
    id: docId,
    merchant_id: merchant.id,
    sub_merchant_id: input.sub_merchant_id ?? null,
    type: input.type,
    file_url: stored.url,
    file_hash: stored.sha256,
  });
  logger.info(
    {
      merchant_id: merchant.id,
      document_id: row.id,
      type: input.type,
      size: stored.size,
    },
    'document uploaded',
  );
  return row;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export async function getDocument(
  merchantId: string,
  documentId: string,
): Promise<DocumentRow> {
  const d = await findDocument(documentId);
  if (!d || d.merchant_id !== merchantId) {
    throw OgunError.notFound('Document', documentId);
  }
  return d;
}

export async function listDocuments(merchantId: string): Promise<DocumentRow[]> {
  await getMerchant(merchantId);
  return listDocumentsByMerchant(merchantId);
}
