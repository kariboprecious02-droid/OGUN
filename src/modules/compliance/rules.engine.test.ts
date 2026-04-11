import { runRules, RuleContext } from './rules.engine';

function baseCtx(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    merchant: {
      legal_name: 'Kwara Kenya Ltd',
      registration_number: 'PVT-2024-12345',
      tax_id: 'P051234567A',
      country: 'KE',
    },
    documents: [
      {
        id: 'doc_1',
        type: 'certificate_of_registration',
        extracted_data: {
          company_name: 'Kwara Kenya Ltd',
          registration_number: 'PVT-2024-12345',
        },
        extraction_confidence: 92,
      },
      { id: 'doc_2', type: 'tax_certificate', extracted_data: {}, extraction_confidence: 90 },
      { id: 'doc_3', type: 'director_id', extracted_data: {}, extraction_confidence: 80 },
      { id: 'doc_4', type: 'bank_confirmation', extracted_data: {}, extraction_confidence: 90 },
    ],
    ...overrides,
  };
}

describe('compliance rules engine (§4.2.2)', () => {
  test('happy path: all rules pass', () => {
    const results = runRules(baseCtx());
    const failing = results.filter((r) => !r.passed);
    expect(failing).toEqual([]);
  });

  test('mandatory_docs fails if a required doc is missing', () => {
    const ctx = baseCtx({
      documents: [{ id: 'doc_1', type: 'certificate_of_registration', extracted_data: {}, extraction_confidence: 90 }],
    });
    const results = runRules(ctx);
    const mandatoryRule = results.find((r) => r.rule_name === 'mandatory_docs')!;
    expect(mandatoryRule.passed).toBe(false);
    const missing = mandatoryRule.details.missing as string[];
    expect(missing).toContain('tax_certificate');
    expect(missing).toContain('director_id');
    expect(missing).toContain('bank_confirmation');
  });

  test('tax_id_format rejects malformed KRA PIN', () => {
    const results = runRules(
      baseCtx({
        merchant: {
          legal_name: 'X',
          registration_number: 'PVT-2024-12345',
          tax_id: 'A123', // too short
          country: 'KE',
        },
      }),
    );
    expect(results.find((r) => r.rule_name === 'tax_id_format')!.passed).toBe(false);
  });

  test('registration_cross_match flags mismatches', () => {
    const results = runRules(
      baseCtx({
        merchant: {
          legal_name: 'Kwara Kenya Ltd',
          registration_number: 'PVT-2024-99999',
          tax_id: 'P051234567A',
          country: 'KE',
        },
      }),
    );
    expect(results.find((r) => r.rule_name === 'registration_cross_match')!.passed).toBe(false);
  });

  test('document_expiry catches expired documents', () => {
    const ctx = baseCtx({
      documents: [
        {
          id: 'doc_1',
          type: 'certificate_of_registration',
          extracted_data: { expiry_date: '2020-01-01' },
          extraction_confidence: 90,
        },
        { id: 'doc_2', type: 'tax_certificate', extracted_data: {}, extraction_confidence: 90 },
        { id: 'doc_3', type: 'director_id', extracted_data: {}, extraction_confidence: 80 },
        { id: 'doc_4', type: 'bank_confirmation', extracted_data: {}, extraction_confidence: 90 },
      ],
    });
    const results = runRules(ctx);
    const expiryRule = results.find((r) => r.rule_name === 'document_expiry')!;
    expect(expiryRule.passed).toBe(false);
  });
});
