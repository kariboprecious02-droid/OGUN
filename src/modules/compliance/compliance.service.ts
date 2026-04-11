/**
 * Orchestrates the 3-layer compliance pipeline (§4.2.4).
 *
 *   1. Layer 1 — document extraction (per document, parallel)
 *   2. Layer 2 — deterministic rules engine
 *   3. Layer 3 — reasoning LLM (structured recommendation)
 *   → persist ComplianceReview
 *   → transition merchant to under_manual_review
 */

import { query } from '@/infra/db/pool';
import { newId } from '@/infra/ids';
import { logger } from '@/infra/logger';
import { getMerchant, transitionMerchant } from '@/modules/merchant/merchant.service';
import { MerchantStatus, MerchantStatusValue } from '@/modules/merchant/merchant.types';
import { OgunError } from '@/infra/errors';
import { extractDocument } from './extraction.service';
import { runRules, RuleContext } from './rules.engine';
import { evaluateCompliance } from './reasoning.service';

type DocumentRow = {
  id: string;
  type: string;
  file_url: string;
  file_hash: string | null;
  extracted_data: Record<string, unknown> | null;
  extraction_confidence: number | null;
};

async function listDocuments(merchantId: string): Promise<DocumentRow[]> {
  const { rows } = await query<DocumentRow>(
    `SELECT id, type, file_url, file_hash, extracted_data, extraction_confidence
     FROM documents WHERE merchant_id = $1`,
    [merchantId],
  );
  return rows;
}

async function storeExtraction(
  documentId: string,
  data: Record<string, unknown>,
  confidence: number,
): Promise<void> {
  await query(
    `UPDATE documents SET extracted_data = $2, extraction_confidence = $3, review_status = 'reviewed'
     WHERE id = $1`,
    [documentId, JSON.stringify(data), confidence],
  );
}

async function persistReview(input: {
  merchantId: string;
  aiOutput: Awaited<ReturnType<typeof evaluateCompliance>>;
  extractedFields: unknown;
  previousStatus: MerchantStatusValue;
  newStatus: MerchantStatusValue;
}): Promise<void> {
  await query(
    `INSERT INTO compliance_reviews
       (id, merchant_id, reviewer_type, decision, confidence_score, flags_raised,
        extracted_fields, explanation_summary, model_identifier,
        previous_status, new_status)
     VALUES ($1,$2,'ai',$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      newId('complianceReview'),
      input.merchantId,
      input.aiOutput.recommendation === 'approve'
        ? 'approve'
        : input.aiOutput.recommendation === 'reject'
        ? 'reject'
        : 'needs_review',
      input.aiOutput.confidence,
      JSON.stringify(input.aiOutput.flags),
      JSON.stringify(input.extractedFields),
      input.aiOutput.explanation,
      input.aiOutput.model_identifier,
      input.previousStatus,
      input.newStatus,
    ],
  );
}

async function persistRuleResults(
  merchantId: string,
  results: ReturnType<typeof runRules>,
): Promise<void> {
  for (const r of results) {
    await query(
      `INSERT INTO compliance_rule_results (id, merchant_id, rule_name, passed, details)
       VALUES ($1,$2,$3,$4,$5)`,
      [newId('complianceRule'), merchantId, r.rule_name, r.passed, JSON.stringify(r.details)],
    );
  }
}

/**
 * Execute the full pipeline for a merchant who has just hit `submit`.
 * Returns the new status.
 */
export async function runCompliancePipeline(merchantId: string): Promise<{
  new_status: MerchantStatusValue;
  recommendation: 'approve' | 'needs_review' | 'reject';
  flags: Array<{ issue: string; severity: string; details: string }>;
}> {
  const merchant = await getMerchant(merchantId);
  if (merchant.status !== MerchantStatus.Submitted) {
    throw OgunError.invalidRequest(
      `Merchant must be in 'submitted' state to run pipeline (current: ${merchant.status})`,
    );
  }

  // Move into AI review
  await transitionMerchant(merchantId, MerchantStatus.UnderAiReview);

  const documents = await listDocuments(merchantId);
  logger.info({ merchant_id: merchantId, document_count: documents.length }, 'compliance pipeline started');

  // Layer 1 — extraction (parallel)
  const extractions = await Promise.all(
    documents.map(async (doc) => {
      const result = await extractDocument({
        documentId: doc.id,
        documentType: doc.type,
        fileUrl: doc.file_url,
        fileHash: doc.file_hash,
      });
      await storeExtraction(
        doc.id,
        { classification: result.classification, ...result.fields },
        Math.round(result.classification_confidence * 100),
      );
      return {
        document_id: doc.id,
        document_type: doc.type,
        fields: result.fields,
        classification_confidence: result.classification_confidence,
      };
    }),
  );

  // Layer 2 — rules
  const ruleContext: RuleContext = {
    merchant: {
      legal_name: merchant.legal_name,
      registration_number: merchant.registration_number,
      tax_id: merchant.tax_id,
      country: merchant.country,
    },
    documents: documents.map((d) => ({
      id: d.id,
      type: d.type,
      extracted_data: d.extracted_data,
      extraction_confidence: d.extraction_confidence,
    })),
  };
  const ruleResults = runRules(ruleContext);
  await persistRuleResults(merchantId, ruleResults);

  // Layer 3 — reasoning
  const aiOutput = await evaluateCompliance({
    merchant: ruleContext.merchant,
    extractions,
    rule_results: ruleResults,
  });

  // Transition into manual review unconditionally (human has final say, §4.2.3)
  await transitionMerchant(merchantId, MerchantStatus.UnderManualReview);

  await persistReview({
    merchantId,
    aiOutput,
    extractedFields: extractions,
    previousStatus: MerchantStatus.UnderAiReview,
    newStatus: MerchantStatus.UnderManualReview,
  });

  logger.info(
    { merchant_id: merchantId, recommendation: aiOutput.recommendation },
    'compliance pipeline complete',
  );

  return {
    new_status: MerchantStatus.UnderManualReview,
    recommendation: aiOutput.recommendation,
    flags: aiOutput.flags,
  };
}

/**
 * Human reviewer decision. Called by `POST /v1/admin/compliance-reviews/{id}`.
 */
export async function submitManualDecision(
  merchantId: string,
  decision: 'approve' | 'changes_requested' | 'reject',
  notes: string,
  actorId?: string,
): Promise<MerchantStatusValue> {
  const merchant = await getMerchant(merchantId);
  if (merchant.status !== MerchantStatus.UnderManualReview) {
    throw OgunError.invalidRequest(
      `Merchant must be under_manual_review (current: ${merchant.status})`,
    );
  }
  const nextStatus: MerchantStatusValue =
    decision === 'approve'
      ? MerchantStatus.Approved
      : decision === 'reject'
      ? MerchantStatus.Rejected
      : MerchantStatus.ChangesRequested;

  await transitionMerchant(merchantId, nextStatus);
  await query(
    `INSERT INTO compliance_reviews
       (id, merchant_id, reviewer_type, decision, notes, actor_id,
        previous_status, new_status)
     VALUES ($1,$2,'human',$3,$4,$5,$6,$7)`,
    [
      newId('complianceReview'),
      merchantId,
      decision === 'approve' ? 'approve' : decision === 'reject' ? 'reject' : 'needs_review',
      notes,
      actorId ?? null,
      MerchantStatus.UnderManualReview,
      nextStatus,
    ],
  );
  return nextStatus;
}
