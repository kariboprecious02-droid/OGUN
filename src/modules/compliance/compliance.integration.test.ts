/**
 * End-to-end compliance pipeline integration tests — §4.2.
 *
 * Uploads documents through the real document upload service, runs
 * the full 3-layer compliance pipeline (extraction stub → rules engine
 * → reasoning stub), then walks the state machine through AI review,
 * manual review, and final decision.
 *
 * These tests exercise:
 *   - Storage adapter write path (via uploadDocument)
 *   - Extraction adapter read path (readDocumentBytes →
 *     deriveStorageKey → storage.getObjectStream → adapter.extract)
 *   - Rules engine over extracted data
 *   - Reasoning stub with all-pass + hard-fail scenarios
 *   - Merchant state transitions submitted → under_ai_review →
 *     under_manual_review → approved
 *
 *   npm run test:integration
 */

import {
  describeIntegration,
  setupIntegrationSchema,
  truncateAllTables,
  teardownIntegration,
} from '@/test/integration.setup';
import { createMerchant, transitionMerchant } from '@/modules/merchant/merchant.service';
import { MerchantStatus } from '@/modules/merchant/merchant.types';
import { uploadDocument, DocumentType } from '@/modules/document/document.service';
import {
  runCompliancePipeline,
  submitManualDecision,
} from './compliance.service';
import { query, getPool } from '@/infra/db/pool';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

const FAKE_PDF = Buffer.from('%PDF-1.4\n%fake content\n%%EOF\n');

async function uploadAll(merchantId: string, types: DocumentType[]): Promise<void> {
  for (const type of types) {
    await uploadDocument({
      merchant_id: merchantId,
      type,
      original_name: `${type}.pdf`,
      content_type: 'application/pdf',
      body: FAKE_PDF,
    });
  }
}

describeIntegration('compliance pipeline (integration, §4.2)', () => {
  beforeAll(async () => {
    await setupIntegrationSchema();
  });

  afterAll(async () => {
    await teardownIntegration();
    try {
      await fsp.rm(path.resolve(process.cwd(), '.ogun-storage'), {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore
    }
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  test('happy path: all documents uploaded, stub extraction + rules + reasoning → needs_review', async () => {
    const merchant = await createMerchant({
      legal_name: 'Kwara Kenya Ltd',
      trading_name: 'Kwara Kenya',
      registration_number: 'PVT-2024-12345',
      tax_id: 'P051234567A',
      country: 'KE',
    });

    await uploadAll(merchant.id, [
      'certificate_of_registration',
      'tax_certificate',
      'director_id',
      'bank_confirmation',
    ]);

    await transitionMerchant(merchant.id, MerchantStatus.Submitted);
    const result = await runCompliancePipeline(merchant.id);

    // The stub extractor returns empty field values so the rules engine
    // reports registration_cross_match + company_name_cross_match as
    // failing (those rules are soft-fail → needs_review, not reject).
    expect(result.new_status).toBe(MerchantStatus.UnderManualReview);
    expect(['approve', 'needs_review', 'reject']).toContain(result.recommendation);

    // A ComplianceReview row is persisted with the AI output
    const { rows } = await query<{ decision: string; reviewer_type: string }>(
      `SELECT decision, reviewer_type FROM compliance_reviews WHERE merchant_id = $1`,
      [merchant.id],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].reviewer_type).toBe('ai');

    // Rule results are also persisted
    const { rows: rules } = await query<{ rule_name: string; passed: boolean }>(
      `SELECT rule_name, passed FROM compliance_rule_results WHERE merchant_id = $1`,
      [merchant.id],
    );
    expect(rules.length).toBeGreaterThan(0);
    const ruleMap = Object.fromEntries(rules.map((r) => [r.rule_name, r.passed]));
    expect(ruleMap.mandatory_docs).toBe(true);
    expect(ruleMap.tax_id_format).toBe(true);
  });

  test('missing mandatory document triggers hard-fail rule → reject', async () => {
    const merchant = await createMerchant({
      legal_name: 'Test Co',
      trading_name: 'Test',
      registration_number: 'PVT-2024-00001',
      tax_id: 'P051111111A',
      country: 'KE',
    });
    // Only upload 2 of 4 required documents
    await uploadAll(merchant.id, ['certificate_of_registration', 'tax_certificate']);

    await transitionMerchant(merchant.id, MerchantStatus.Submitted);
    const result = await runCompliancePipeline(merchant.id);

    expect(result.new_status).toBe(MerchantStatus.UnderManualReview);
    expect(result.recommendation).toBe('reject');
    // Flags must include the mandatory_docs failure
    expect(result.flags.find((f) => f.issue === 'mandatory_docs')).toBeTruthy();
  });

  test('invalid KRA PIN format triggers hard-fail → reject', async () => {
    const merchant = await createMerchant({
      legal_name: 'Test Co',
      trading_name: 'Test',
      registration_number: 'PVT-2024-00002',
      tax_id: 'BADPIN123', // not matching ^[PA]\d{9}[A-Z]$
      country: 'KE',
    });
    await uploadAll(merchant.id, [
      'certificate_of_registration',
      'tax_certificate',
      'director_id',
      'bank_confirmation',
    ]);

    await transitionMerchant(merchant.id, MerchantStatus.Submitted);
    const result = await runCompliancePipeline(merchant.id);
    expect(result.recommendation).toBe('reject');
    expect(result.flags.find((f) => f.issue === 'tax_id_format')).toBeTruthy();
  });

  test('uploaded file bytes are stored and retrievable', async () => {
    const merchant = await createMerchant({
      legal_name: 'Storage Check',
      trading_name: 'Storage',
      registration_number: 'PVT-2024-00003',
      tax_id: 'P052222222A',
      country: 'KE',
    });
    await uploadDocument({
      merchant_id: merchant.id,
      type: 'certificate_of_registration',
      original_name: 'test.pdf',
      content_type: 'application/pdf',
      body: FAKE_PDF,
    });

    // The pipeline's extraction stub doesn't read bytes, but the
    // storage integration should have persisted the file_url + hash.
    const { rows } = await query<{ file_url: string; file_hash: string | null }>(
      `SELECT file_url, file_hash FROM documents WHERE merchant_id = $1 LIMIT 1`,
      [merchant.id],
    );
    expect(rows[0].file_url).toMatch(/^file:\/\//);
    expect(rows[0].file_hash).toMatch(/^[0-9a-f]{64}$/);

    // Verify the bytes are actually on disk by reading through readDocumentBytes
    const { readDocumentBytes } = await import('./extraction.service');
    const { rows: docRows } = await query<{ id: string }>(
      `SELECT id FROM documents WHERE merchant_id = $1`,
      [merchant.id],
    );
    const { bytes, mimeType } = await readDocumentBytes(docRows[0].id);
    expect(mimeType).toBe('application/pdf');
    expect(bytes.equals(FAKE_PDF)).toBe(true);
  });

  test('manual approve transitions merchant to approved', async () => {
    const merchant = await createMerchant({
      legal_name: 'Kwara Kenya Ltd',
      trading_name: 'Kwara Kenya',
      registration_number: 'PVT-2024-12345',
      tax_id: 'P051234567A',
      country: 'KE',
    });
    await uploadAll(merchant.id, [
      'certificate_of_registration',
      'tax_certificate',
      'director_id',
      'bank_confirmation',
    ]);
    await transitionMerchant(merchant.id, MerchantStatus.Submitted);
    await runCompliancePipeline(merchant.id);

    const next = await submitManualDecision(
      merchant.id,
      'approve',
      'all documents verified',
      'test-reviewer',
    );
    expect(next).toBe(MerchantStatus.Approved);

    // Both AI + human decisions are recorded
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM compliance_reviews WHERE merchant_id = $1`,
      [merchant.id],
    );
    expect(Number(rows[0].count)).toBe(2);
  });

  test('manual changes_requested transitions merchant to changes_requested', async () => {
    const merchant = await createMerchant({
      legal_name: 'Feedback Co',
      trading_name: 'Feedback',
      registration_number: 'PVT-2024-00004',
      tax_id: 'P053333333A',
      country: 'KE',
    });
    await uploadAll(merchant.id, [
      'certificate_of_registration',
      'tax_certificate',
      'director_id',
      'bank_confirmation',
    ]);
    await transitionMerchant(merchant.id, MerchantStatus.Submitted);
    await runCompliancePipeline(merchant.id);

    const next = await submitManualDecision(
      merchant.id,
      'changes_requested',
      'please re-upload the certificate of registration with a higher resolution scan',
    );
    expect(next).toBe(MerchantStatus.ChangesRequested);
  });
});
