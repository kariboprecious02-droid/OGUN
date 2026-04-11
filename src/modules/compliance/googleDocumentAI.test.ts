import { mapDocumentAIResponse } from './googleDocumentAI';
import type { google } from '@google-cloud/documentai/build/protos/protos';

type IDocument = google.cloud.documentai.v1.IDocument;

describe('Google Document AI response mapping', () => {
  test('extracts top-level entities into fields + confidence', () => {
    const doc: IDocument = {
      text: 'Kwara Kenya Ltd — Certificate of Registration',
      entities: [
        { type: 'company_name', mentionText: 'Kwara Kenya Ltd', confidence: 0.97 },
        { type: 'registration_number', mentionText: 'PVT-2024-12345', confidence: 0.93 },
      ],
    } as IDocument;

    const result = mapDocumentAIResponse(doc, 'certificate_of_registration');
    expect(result.classification).toBe('certificate_of_registration');
    expect(result.fields.company_name).toBe('Kwara Kenya Ltd');
    expect(result.fields.registration_number).toBe('PVT-2024-12345');
    expect(result.fields_confidence.company_name).toBe(0.97);
    expect(result.fields_confidence.registration_number).toBe(0.93);
    expect(result.classification_confidence).toBe(0.97); // max of field confidences
    expect(result.raw_text).toContain('Kwara Kenya Ltd');
    expect(result.errors).toEqual([]);
  });

  test('normalizes entity keys to snake_case', () => {
    const doc: IDocument = {
      entities: [
        { type: 'Company Name', mentionText: 'X Co', confidence: 0.9 },
        { type: 'Tax-ID', mentionText: 'P051234567A', confidence: 0.85 },
      ],
    } as IDocument;
    const result = mapDocumentAIResponse(doc, 'tax_certificate');
    expect(result.fields.company_name).toBe('X Co');
    expect(result.fields.tax_id).toBe('P051234567A');
  });

  test('aliases common synonym field names to canonical keys', () => {
    const doc: IDocument = {
      entities: [
        { type: 'kra_pin', mentionText: 'A012345678X', confidence: 0.88 },
        { type: 'business_name', mentionText: 'Kwara Nairobi Ltd', confidence: 0.92 },
      ],
    } as IDocument;
    const result = mapDocumentAIResponse(doc, 'tax_certificate');
    // Canonical keys populated via aliasing
    expect(result.fields.tax_id).toBe('A012345678X');
    expect(result.fields.company_name).toBe('Kwara Nairobi Ltd');
  });

  test('uses normalizedValue.text when mentionText is missing', () => {
    const doc: IDocument = {
      entities: [
        {
          type: 'registration_number',
          normalizedValue: { text: 'PVT-2024-99999' },
          confidence: 0.9,
        },
      ],
    } as IDocument;
    const result = mapDocumentAIResponse(doc, 'certificate_of_registration');
    expect(result.fields.registration_number).toBe('PVT-2024-99999');
  });

  test('empty entity list yields low-confidence other classification', () => {
    const doc: IDocument = { text: 'scanned noise', entities: [] } as IDocument;
    const result = mapDocumentAIResponse(doc, 'certificate_of_registration');
    expect(result.fields).toEqual({});
    expect(result.classification_confidence).toBe(0.4);
    expect(result.raw_text).toBe('scanned noise');
  });

  test('confidence is rounded to 2 decimal places', () => {
    const doc: IDocument = {
      entities: [{ type: 'name', mentionText: 'Jane', confidence: 0.876543 }],
    } as IDocument;
    const result = mapDocumentAIResponse(doc, 'director_id');
    expect(result.fields_confidence.name).toBe(0.88);
  });

  test('skips entities with empty mentionText and no normalizedValue', () => {
    const doc: IDocument = {
      entities: [
        { type: 'name', mentionText: '', confidence: 0.5 },
        { type: 'id_number', mentionText: '12345678', confidence: 0.9 },
      ],
    } as IDocument;
    const result = mapDocumentAIResponse(doc, 'director_id');
    expect(result.fields.name).toBeUndefined();
    expect(result.fields.id_number).toBe('12345678');
  });
});
