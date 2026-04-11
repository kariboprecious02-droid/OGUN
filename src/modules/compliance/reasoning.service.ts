/**
 * Layer 3 — Compliance Reasoning LLM (§4.2.3).
 *
 * Live implementation that prefers Anthropic's Claude model when
 * `ANTHROPIC_API_KEY` is set, and falls back to a deterministic stub
 * (rule-engine-driven recommendation) otherwise.
 *
 * Prompt-caching is enabled so the system prompt and the Ogun
 * compliance policy text can be reused across merchant submissions
 * without being re-billed every call.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { RuleResult } from './rules.engine';
import { config } from '@/infra/config';
import { logger } from '@/infra/logger';

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

const MODEL_ID = 'claude-opus-4-6';
const STUB_MODEL = 'ogun-compliance-stub-v1';

/**
 * System prompt — cached across calls so repeated compliance reviews
 * reuse the same tokenization and don't pay for the policy text again.
 * Based on the §4.2.3 example prompt with Ogun-specific policy.
 */
const SYSTEM_PROMPT = `You are a compliance review assistant for Ogun, a Kenyan
payment infrastructure platform. Your job is to evaluate a merchant
onboarding application by cross-checking the merchant's submitted form
data against fields extracted from uploaded compliance documents and
the results of a deterministic rules engine.

You must produce a recommendation (approve, needs_review, or reject)
with flags that explain every detected concern. You must respond in
valid JSON only, matching this shape exactly:

{
  "recommendation": "approve" | "needs_review" | "reject",
  "confidence": <integer 0-100>,
  "flags": [
    {
      "issue": "<short_snake_case>",
      "severity": "low" | "medium" | "high",
      "details": "<one-sentence explanation>"
    }
  ],
  "explanation": "<2-4 sentence overall rationale>"
}

Policy guidance:
- Any rule engine FAILURE must appear in the flags array, even if
  Claude believes the failure is cosmetic. The rules engine is the
  ground truth for hard requirements.
- Recommend "reject" only if there is strong evidence of fraud or
  impersonation. Most issues should be "needs_review".
- Minor spelling variants in names (e.g. "Ltd" vs "Limited") and low
  OCR confidence (< 0.80) are medium-severity flags, not rejections.
- Registration / tax ID mismatches between the form and extracted
  documents are high-severity flags requiring human review.`;

/**
 * Build the per-merchant user prompt with the structured data.
 */
function buildUserPrompt(input: ReasoningInput): string {
  const ruleSummary = input.rule_results
    .map((r) => `  - ${r.rule_name}: ${r.passed ? 'PASSED' : 'FAILED'} ${JSON.stringify(r.details)}`)
    .join('\n');
  const extractionSummary = input.extractions
    .map(
      (e) =>
        `  - ${e.document_type}: ${JSON.stringify(e.fields)} (conf: ${e.classification_confidence.toFixed(2)})`,
    )
    .join('\n');

  return `MERCHANT SUBMITTED DATA:
- Legal name: ${input.merchant.legal_name}
- Registration: ${input.merchant.registration_number ?? '(not provided)'}
- Tax ID (KRA PIN): ${input.merchant.tax_id ?? '(not provided)'}
- Country: ${input.merchant.country}

EXTRACTED FROM DOCUMENTS:
${extractionSummary || '  (no documents extracted)'}

RULE ENGINE RESULTS:
${ruleSummary || '  (no rules evaluated)'}

Evaluate this application and respond in JSON only.`;
}

function stubEvaluate(input: ReasoningInput): ReasoningOutput {
  const failedRules = input.rule_results.filter((r) => !r.passed);
  const hasHardFail = failedRules.some((r) =>
    ['mandatory_docs', 'tax_id_format', 'registration_cross_match', 'document_expiry'].includes(
      r.rule_name,
    ),
  );

  if (failedRules.length === 0) {
    return {
      recommendation: 'approve',
      confidence: 92,
      flags: [],
      explanation: 'All deterministic rules passed and extracted fields match the submitted form data.',
      model_identifier: STUB_MODEL,
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
    model_identifier: STUB_MODEL,
  };
}

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Live compliance evaluation. Prefers Claude when credentials are
 * available; otherwise uses the deterministic stub. Rule engine
 * failures always win over LLM output — even if Claude returns
 * `approve`, any hard-fail rule downgrades the recommendation.
 */
export async function evaluateCompliance(input: ReasoningInput): Promise<ReasoningOutput> {
  const anthropic = getClient();
  if (!anthropic) {
    logger.debug('ANTHROPIC_API_KEY not set; using deterministic compliance stub');
    return stubEvaluate(input);
  }

  try {
    const userPrompt = buildUserPrompt(input);
    const response = await anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude response contained no text block');
    }
    const parsed = JSON.parse(textBlock.text) as Partial<ReasoningOutput>;
    const llmOutput: ReasoningOutput = {
      recommendation: parsed.recommendation ?? 'needs_review',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 50,
      flags: Array.isArray(parsed.flags) ? (parsed.flags as ReasoningOutput['flags']) : [],
      explanation:
        typeof parsed.explanation === 'string'
          ? parsed.explanation
          : 'Claude returned no explanation; defaulted.',
      model_identifier: response.model ?? MODEL_ID,
    };

    // Hard-fail override: if any gating rule failed, we do NOT let the
    // LLM approve the application. Downgrade to reject with the failing
    // rules attached as flags.
    const failedHardRules = input.rule_results.filter(
      (r) =>
        !r.passed &&
        ['mandatory_docs', 'tax_id_format', 'registration_cross_match', 'document_expiry'].includes(
          r.rule_name,
        ),
    );
    if (failedHardRules.length > 0 && llmOutput.recommendation === 'approve') {
      logger.warn(
        { failed_rules: failedHardRules.map((r) => r.rule_name) },
        'Claude returned approve but hard-fail rules failed; downgrading to reject',
      );
      return {
        ...llmOutput,
        recommendation: 'reject',
        confidence: Math.max(llmOutput.confidence, 75),
        flags: [
          ...llmOutput.flags,
          ...failedHardRules.map((r) => ({
            issue: r.rule_name,
            severity: 'high' as const,
            details: `Hard-fail rule: ${JSON.stringify(r.details)}`,
          })),
        ],
        explanation:
          llmOutput.explanation +
          ' NOTE: downgraded from approve to reject because a deterministic rule engine hard-fail was detected.',
      };
    }

    return llmOutput;
  } catch (err) {
    logger.error({ err }, 'Claude reasoning call failed; falling back to stub');
    return stubEvaluate(input);
  }
}
