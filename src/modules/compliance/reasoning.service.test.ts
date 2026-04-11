import { evaluateCompliance } from './reasoning.service';

describe('compliance reasoning fallback (§4.2.3)', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterAll(() => {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  test('all rules pass → approve with high confidence', async () => {
    const out = await evaluateCompliance({
      merchant: {
        legal_name: 'Kwara Kenya Ltd',
        registration_number: 'PVT-2024-12345',
        tax_id: 'P051234567A',
        country: 'KE',
      },
      extractions: [],
      rule_results: [
        { rule_name: 'mandatory_docs', passed: true, details: {} },
        { rule_name: 'tax_id_format', passed: true, details: {} },
      ],
    });
    expect(out.recommendation).toBe('approve');
    expect(out.confidence).toBeGreaterThanOrEqual(90);
    expect(out.flags).toEqual([]);
    expect(out.model_identifier).toBe('ogun-compliance-stub-v1');
  });

  test('hard-fail rule → reject recommendation with high severity flag', async () => {
    const out = await evaluateCompliance({
      merchant: {
        legal_name: 'X Co',
        registration_number: 'PVT-1',
        tax_id: null,
        country: 'KE',
      },
      extractions: [],
      rule_results: [
        { rule_name: 'mandatory_docs', passed: false, details: { missing: ['tax_certificate'] } },
      ],
    });
    expect(out.recommendation).toBe('reject');
    expect(out.flags).toHaveLength(1);
    expect(out.flags[0].severity).toBe('high');
    expect(out.flags[0].issue).toBe('mandatory_docs');
  });

  test('soft-fail rule → needs_review with medium severity', async () => {
    const out = await evaluateCompliance({
      merchant: {
        legal_name: 'Kwara Kenya Ltd',
        registration_number: 'PVT-2024-12345',
        tax_id: 'P051234567A',
        country: 'KE',
      },
      extractions: [],
      rule_results: [
        {
          rule_name: 'company_name_cross_match',
          passed: false,
          details: { form: 'Kwara Kenya Ltd', document: 'Kwara Kenya Limited' },
        },
      ],
    });
    expect(out.recommendation).toBe('needs_review');
    expect(out.flags[0].severity).toBe('medium');
  });
});
