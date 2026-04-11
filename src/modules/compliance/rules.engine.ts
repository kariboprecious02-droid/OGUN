/**
 * Layer 2 — Deterministic Rules Engine (§4.2.2).
 *
 * Each rule is a pure function returning { rule_name, passed, details }.
 * A rule FAILURE is an automatic flag irrespective of the reasoning LLM output.
 */

export type RuleContext = {
  merchant: {
    legal_name: string;
    registration_number: string | null;
    tax_id: string | null;
    country: string;
  };
  documents: Array<{
    id: string;
    type: string;
    extracted_data: Record<string, unknown> | null;
    extraction_confidence: number | null;
  }>;
};

export type RuleResult = {
  rule_name: string;
  passed: boolean;
  details: Record<string, unknown>;
};

const REQUIRED_DOCUMENT_TYPES = [
  'certificate_of_registration',
  'tax_certificate',
  'director_id',
  'bank_confirmation',
];

function mandatoryDocsRule(ctx: RuleContext): RuleResult {
  const uploaded = new Set(ctx.documents.map((d) => d.type));
  const missing = REQUIRED_DOCUMENT_TYPES.filter((t) => !uploaded.has(t));
  return {
    rule_name: 'mandatory_docs',
    passed: missing.length === 0,
    details: { missing },
  };
}

function taxIdFormatRule(ctx: RuleContext): RuleResult {
  // KRA PIN: starts with P or A, followed by 9 digits, ends with capital letter
  const v = ctx.merchant.tax_id ?? '';
  const valid = /^[PA]\d{9}[A-Z]$/.test(v);
  return { rule_name: 'tax_id_format', passed: valid, details: { value: v } };
}

function registrationCrossMatchRule(ctx: RuleContext): RuleResult {
  const cor = ctx.documents.find((d) => d.type === 'certificate_of_registration');
  const docReg =
    (cor?.extracted_data?.['registration_number'] as string | undefined) ?? null;
  const formReg = ctx.merchant.registration_number;
  // If no CoR uploaded, mandatory_docs rule will flag that separately
  if (!cor || !docReg || !formReg) {
    return {
      rule_name: 'registration_cross_match',
      passed: false,
      details: { form: formReg, document: docReg, reason: 'missing_data' },
    };
  }
  return {
    rule_name: 'registration_cross_match',
    passed: docReg.trim().toLowerCase() === formReg.trim().toLowerCase(),
    details: { form: formReg, document: docReg },
  };
}

function documentExpiryRule(ctx: RuleContext): RuleResult {
  const today = new Date();
  const expired: Array<{ id: string; type: string; expiry: string }> = [];
  for (const doc of ctx.documents) {
    const expiry = (doc.extracted_data?.['expiry_date'] as string | undefined) ?? null;
    if (expiry && new Date(expiry) < today) {
      expired.push({ id: doc.id, type: doc.type, expiry });
    }
  }
  return {
    rule_name: 'document_expiry',
    passed: expired.length === 0,
    details: { expired },
  };
}

function companyNameCrossMatchRule(ctx: RuleContext): RuleResult {
  const cor = ctx.documents.find((d) => d.type === 'certificate_of_registration');
  const docName = (cor?.extracted_data?.['company_name'] as string | undefined) ?? null;
  const formName = ctx.merchant.legal_name;
  if (!cor || !docName) {
    return { rule_name: 'company_name_cross_match', passed: false, details: { reason: 'missing_extraction' } };
  }
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(ltd|limited|plc|inc|co)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  return {
    rule_name: 'company_name_cross_match',
    passed: norm(formName) === norm(docName),
    details: { form: formName, document: docName },
  };
}

const RULES = [
  mandatoryDocsRule,
  taxIdFormatRule,
  registrationCrossMatchRule,
  documentExpiryRule,
  companyNameCrossMatchRule,
];

export function runRules(ctx: RuleContext): RuleResult[] {
  return RULES.map((rule) => rule(ctx));
}
