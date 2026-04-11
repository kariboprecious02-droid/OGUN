import { MerchantStatus, canTransition } from './merchant.types';

describe('merchant onboarding state machine (§4.1)', () => {
  test('draft → submitted allowed', () => {
    expect(canTransition(MerchantStatus.Draft, MerchantStatus.Submitted)).toBe(true);
  });

  test('submitted → under_ai_review allowed', () => {
    expect(canTransition(MerchantStatus.Submitted, MerchantStatus.UnderAiReview)).toBe(true);
  });

  test('under_ai_review → under_manual_review | changes_requested | rejected', () => {
    expect(canTransition(MerchantStatus.UnderAiReview, MerchantStatus.UnderManualReview)).toBe(true);
    expect(canTransition(MerchantStatus.UnderAiReview, MerchantStatus.ChangesRequested)).toBe(true);
    expect(canTransition(MerchantStatus.UnderAiReview, MerchantStatus.Rejected)).toBe(true);
  });

  test('under_manual_review → approved | changes_requested | rejected', () => {
    expect(canTransition(MerchantStatus.UnderManualReview, MerchantStatus.Approved)).toBe(true);
    expect(canTransition(MerchantStatus.UnderManualReview, MerchantStatus.ChangesRequested)).toBe(true);
    expect(canTransition(MerchantStatus.UnderManualReview, MerchantStatus.Rejected)).toBe(true);
  });

  test('approved → credentials_issued → active', () => {
    expect(canTransition(MerchantStatus.Approved, MerchantStatus.CredentialsIssued)).toBe(true);
    expect(canTransition(MerchantStatus.CredentialsIssued, MerchantStatus.Active)).toBe(true);
  });

  test('changes_requested → submitted (resubmit)', () => {
    expect(canTransition(MerchantStatus.ChangesRequested, MerchantStatus.Submitted)).toBe(true);
  });

  test('active ↔ suspended', () => {
    expect(canTransition(MerchantStatus.Active, MerchantStatus.Suspended)).toBe(true);
    expect(canTransition(MerchantStatus.Suspended, MerchantStatus.Active)).toBe(true);
  });

  test('illegal transitions are rejected', () => {
    expect(canTransition(MerchantStatus.Draft, MerchantStatus.Active)).toBe(false);
    expect(canTransition(MerchantStatus.Approved, MerchantStatus.Active)).toBe(false);
    expect(canTransition(MerchantStatus.Rejected, MerchantStatus.Approved)).toBe(false);
  });
});
