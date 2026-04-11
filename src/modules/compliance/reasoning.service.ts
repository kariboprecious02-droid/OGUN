/**
 * Layer 3 — Compliance Reasoning LLM (§4.2.3).
 *
 * Real implementation: invoke a reasoning model (Claude / GPT-4 / Gemini)
 * with the structured prompt defined in §4.2.3.  For MVP we emit a
 * deterministic recommendation derived from the rule engine results
 * so that the pipeline is testable end-to-end.
 */

import type { RuleResult } from './rules.engine';

export type ReasoningInput = {
  merchant: {
    legal_name: string;
    registration_number: string | null;
    tax_id: string | null;
    country: string;
  };
  extractions: Array<{
    document_id: string;
    document_type: string;
    fields: Record<string, string>;
    classification_confidence: number;
  }>;
  rule_results: RuleResult[];
};

export type ReasoningOutput = {
  recommendation: 'approve' | 'needs_review' | 'reject';
  confidence: number;
  flags: Array<{ issue: string; severity: 'low' | 'medium' | 'high'; details: string }>;
  explanation: string;
  model_identifier: string;
};

export async function evaluateCompliance(input: ReasoningInput): Promise<ReasoningOutput> {
  const failedRules = input.rule_results.filter((r) => !r.passed);
  const hasHardFail = failedRules.some((r) =>
    ['mandatory_docs', 'tax_id_format', 'registration_cross_match', 'document_expiry'].includes(r.rule_name),
  );

  if (failedRules.length === 0) {
    return {
      recommendation: 'approve',
      confidence: 92,
      flags: [],
      explanation: 'All deterministic rules passed and extracted fields match the submitted form data.',
      model_identifier: 'ogun-compliance-stub-v1',
    };
  }

  return {
    recommendation: hasHardFail ? 'reject' : 'needs_review',
    confidence: hasHardFail ? 85 : 65,
    flags: failedRules.map((r) => ({
      issue: r.rule_name,
      severity: hasHardFail ? 'high' : 'medium',
      details: JSON.stringify(r.details),
    })),
    explanation: `Rules engine reported ${failedRules.length} failing rule(s). ${
      hasHardFail ? 'A hard-fail rule triggered automatic rejection.' : 'Human review required.'
    }`,
    model_identifier: 'ogun-compliance-stub-v1',
  };
}
