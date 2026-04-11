import {
  StubExtractionAdapter,
  getExtractionAdapter,
  setExtractionAdapter,
  extractDocument,
} from './extraction.service';

describe('extraction adapter selection', () => {
  const originalProjectId = process.env.GOOGLE_DOCUMENTAI_PROJECT_ID;

  beforeEach(() => {
    setExtractionAdapter(null);
    delete process.env.GOOGLE_DOCUMENTAI_PROJECT_ID;
  });

  afterAll(() => {
    if (originalProjectId !== undefined) {
      process.env.GOOGLE_DOCUMENTAI_PROJECT_ID = originalProjectId;
    }
  });

  test('defaults to stub adapter when Google Document AI is not configured', () => {
    const adapter = getExtractionAdapter();
    expect(adapter.name).toBe('stub');
    expect(adapter).toBeInstanceOf(StubExtractionAdapter);
  });

  test('stub adapter returns per-type canonical fields', async () => {
    setExtractionAdapter(new StubExtractionAdapter());
    const result = await extractDocument({
      documentId: 'doc_test',
      documentType: 'certificate_of_registration',
      fileUrl: 'file:///stub',
      fileHash: 'abc',
    });
    expect(result.classification).toBe('certificate_of_registration');
    expect(result.fields).toHaveProperty('company_name');
    expect(result.fields).toHaveProperty('registration_number');
    expect(result.adapter).toBe('stub');
  });

  test('stub adapter handles unknown document types with "other"', async () => {
    setExtractionAdapter(new StubExtractionAdapter());
    const result = await extractDocument({
      documentId: 'doc_test',
      documentType: 'some_random_type',
      fileUrl: 'file:///stub',
      fileHash: null,
    });
    expect(result.classification).toBe('other');
    expect(result.fields).toEqual({});
    expect(result.adapter).toBe('stub');
  });

  test('extractDocument captures adapter errors into the errors array', async () => {
    const failingAdapter = {
      name: 'failing',
      async extract() {
        throw new Error('provider unreachable');
      },
    };
    setExtractionAdapter(failingAdapter);
    const result = await extractDocument({
      documentId: 'doc_test',
      documentType: 'certificate_of_registration',
      fileUrl: 'file:///stub',
      fileHash: null,
    });
    expect(result.classification_confidence).toBe(0);
    expect(result.errors).toContain('provider unreachable');
    expect(result.adapter).toBe('failing');
  });
});
