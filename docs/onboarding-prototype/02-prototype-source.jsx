// Ogun Onboarding Prototype — v1.2
// Single-file React app: admin + merchant view, journey bar, 8 steps + sub-merchant drawer
// Fixes from v1.1 review:
//  1. Profile fields auto-extracted from uploaded docs
//  2. Multiple directors supported
//  3. Real file picker wired
//  4. Settlement fee in KES, min 100
//  5. Decision toggle on Review functional, with note
//  6. Activate CTA visible

const { useState, useEffect, useRef, useMemo } = React;

// ----- constants -----------------------------------------------------------

const MERCHANT_STATUSES = [
  "draft",
  "kyb_in_progress",
  "kyb_approved",
  "credentials_issued",
  "settings_configured",
  "ready_for_activation",
  "active",
  "rejected",
  "suspended",
  "terminated",
];

// Step order — extraction first (people + docs), then verify the auto-filled profile,
// then commercials. Mirrors the backend flow: Documents create the source of truth,
// Merchant fields are derived, Settings are independent commercial config.
// PK feedback v1.2.2: Sub-merchants are not a separate step — they live as an
// optional CTA inside Settings, which duplicates the parent's methods, fees,
// and settlement destination into the new sub. Backend schema supports this
// directly: merchant_settings.sub_merchant_id and documents.sub_merchant_id
// are both nullable FKs (migrations/0001 lines 59, 78) with "inheritable by
// sub-merchant" semantics. Step count drops 7 → 6.
const STEPS = [
  { id: 1, key: "people_documents", label: "People & Documents", verb: "Upload" },
  { id: 2, key: "profile", label: "Profile", verb: "Verify" },
  { id: 3, key: "settings", label: "Settings", verb: "Configure" },
  { id: 4, key: "compliance", label: "AI Compliance", verb: "Run" },
  { id: 5, key: "review", label: "Review", verb: "Decide" },
  { id: 6, key: "activate", label: "Activate", verb: "Activate" },
];

// editable matrix: status × step → editable
// 1=People+Docs, 2=Profile, 3=Settings, 4=AI Compliance, 5=Review, 6=Activate
const STEP_EDIT_MATRIX = {
  draft: { 1: true, 2: true, 3: false, 4: false, 5: false, 6: false },
  kyb_in_progress: { 1: true, 2: true, 3: false, 4: true, 5: false, 6: false },
  kyb_approved: { 1: false, 2: false, 3: true, 4: false, 5: true, 6: false },
  credentials_issued: { 1: false, 2: false, 3: true, 4: false, 5: false, 6: false },
  settings_configured: { 1: false, 2: false, 3: true, 4: false, 5: false, 6: true },
  ready_for_activation: { 1: false, 2: false, 3: true, 4: false, 5: false, 6: true },
  active: { 1: false, 2: false, 3: true, 4: false, 5: false, 6: false },
  rejected: { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false },
  suspended: { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false },
  terminated: { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false },
};

const STATUS_TINT = {
  draft: "bg-slate-800 text-slate-300 border-slate-700",
  kyb_in_progress: "bg-amber-900/30 text-amber-200 border-amber-700/50",
  kyb_approved: "bg-blue-50 text-blue-800 border-blue-200",
  credentials_issued: "bg-blue-50 text-blue-800 border-blue-200",
  settings_configured: "bg-blue-50 text-blue-800 border-blue-200",
  ready_for_activation: "bg-indigo-900/30 text-indigo-200 border-indigo-700/50",
  active: "bg-emerald-900/30 text-emerald-200 border-emerald-700/50",
  rejected: "bg-rose-900/30 text-rose-200 border-rose-700/50",
  suspended: "bg-orange-50 text-orange-800 border-orange-200",
  terminated: "bg-zinc-200 text-zinc-700 border-zinc-300",
};

// v1.3.0 — post-activation wiring:
//   ComplianceList (entry) → onboarding wizard → back to list → MerchantPanel
//   MerchantPanel tabs: Settings (Profile · Accounts · Sub-merchants · Credentials) ·
//                       Collections · Payouts · Settlements
//
// Seed merchant (Kwara Kenya Ltd, mrc_01KP0PRBC1FZY4J7Q10QKR3E1E, ACTIVE) mirrors
// the live compliance-list screen PK validated on 2026-04-24.
const INITIAL_MERCHANTS = [
  {
    id: "mrc_01KP0PRBC1FZY4J7Q10QKR3E1E",
    legal_name: "Kwara Kenya Ltd",
    trading_name: "Kwara Kenya",
    registration_number: "PVT-K-2024-00042",
    tax_id: "P051000042X",
    country: "KE",
    settlement_currency: "KES",
    business_category: "financial_services",
    website_url: "https://kwara.com",
    business_address: "Muthangari Drive, Westlands, Nairobi",
    status: "active",
    created_at: "2026-03-18T09:12:04.000Z",
    updated_at: "2026-04-12T11:20:43.000Z",
    contact_name: "Cynthia Wanjiku",
    contact_email: "ops@kwara.com",
    contact_phone: "+254 711 000 042",
    credentials: {
      publishable: "pk_test_kwar9a81mxlrq7vbt4g0",
      secret: "sk_test_kwar4c77pqtwn2zf9h31",
      webhook_secret: "whsec_kwarj4xd92pmrv5b7nqy1f8",
      issued_at: "2026-04-12T11:20:43.000Z",
    },
    settings: {
      collection_fee_pct: 1.5,
      collection_fee_model: "merchant_covers",
      payout_fee_pct: 1.0,
      payout_fee_model: "merchant_covers",
      settlement_fee_pct: 0.1,
      enabled_methods: ["mpesa", "airtel", "bank"],
      notification_emails: ["ops@kwara.com", "finance@kwara.com"],
    },
    sub_merchants: [
      {
        id: "smrc_01KP0PRBC1KWR1",
        name: "Kwara Savings Cooperative",
        code: "KWA-001",
        status: "active",
        settlement_preference: "daily",
        settlement_destination: { bank_name: "Equity Bank Kenya", account_number: "•••• 4092" },
      },
      {
        id: "smrc_01KP0PRBC1KWR2",
        name: "Kwara SACCO Partners",
        code: "KWA-002",
        status: "active",
        settlement_preference: "weekly",
        settlement_destination: { bank_name: "KCB Group", account_number: "•••• 7741" },
      },
    ],
    activity: {
      // 7-day rolling data for charts, most-recent-first-index = 6 (today)
      collections: {
        tpv_7d_cents: 420_000_000, // KES 4.2M
        success_rate: 0.94,
        pending: 12,
        failed: 8,
        daily_tpv_cents: [23_000_000, 31_000_000, 54_000_000, 72_000_000, 90_000_000, 68_000_000, 82_000_000],
        recent: [
          { id: "col_01KP4A2...", method: "mpesa", provider: "safaricom", amount: 1_250_000, fee: 18_750, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T07:42:18Z" },
          { id: "col_01KP4A1...", method: "airtel", provider: "airtel_money", amount: 420_000, fee: 6_300, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T07:05:01Z" },
          { id: "col_01KP49Z...", method: "mpesa", provider: "safaricom", amount: 3_150_000, fee: 47_250, business_status: "pending", internal_status: "awaiting_callback", settlement_eligible: false, refund_status: "none", created_at: "2026-04-24T06:58:33Z" },
          { id: "col_01KP49Y...", method: "mpesa", provider: "safaricom", amount: 860_000, fee: 12_900, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T06:41:10Z" },
          { id: "col_01KP49W...", method: "bank", provider: "paystack", amount: 5_200_000, fee: 78_000, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T06:12:55Z" },
          { id: "col_01KP49T...", method: "mpesa", provider: "safaricom", amount: 240_000, fee: 3_600, business_status: "failed", internal_status: "provider_declined", settlement_eligible: false, refund_status: "none", created_at: "2026-04-24T05:58:02Z" },
          { id: "col_01KP49R...", method: "airtel", provider: "airtel_money", amount: 1_800_000, fee: 27_000, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T05:40:21Z" },
          { id: "col_01KP49P...", method: "mpesa", provider: "safaricom", amount: 125_000, fee: 1_875, business_status: "refunded", internal_status: "refund_completed", settlement_eligible: false, refund_status: "completed", created_at: "2026-04-24T05:12:45Z" },
          { id: "col_01KP49M...", method: "bank", provider: "paystack", amount: 2_400_000, fee: 36_000, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T04:51:19Z" },
          { id: "col_01KP49K...", method: "mpesa", provider: "safaricom", amount: 680_000, fee: 10_200, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T04:32:08Z" },
        ],
      },
      payouts: {
        volume_7d_cents: 280_000_000, // KES 2.8M
        success_rate: 0.96,
        pending: 3,
        reserved_cents: 18_000_000, // KES 180k
        daily_volume_cents: [18_000_000, 22_000_000, 48_000_000, 36_000_000, 52_000_000, 42_000_000, 62_000_000],
        recent: [
          { id: "pay_01KP4B3...", recipient: "254 722 ••• 841 (M-Pesa)", amount: 450_000, fee_model: "merchant_covers", status: "succeeded", created_at: "2026-04-24T08:02:11Z" },
          { id: "pay_01KP4B2...", recipient: "Equity 0045 ••• 1139", amount: 1_200_000, fee_model: "recipient_covers", status: "processing", created_at: "2026-04-24T07:48:50Z" },
          { id: "pay_01KP4B1...", recipient: "254 728 ••• 220 (M-Pesa)", amount: 180_000, fee_model: "merchant_covers", status: "succeeded", created_at: "2026-04-24T07:31:04Z" },
          { id: "pay_01KP4A9...", recipient: "KCB 0100 ••• 8831", amount: 3_400_000, fee_model: "merchant_covers", status: "succeeded", created_at: "2026-04-24T07:18:22Z" },
          { id: "pay_01KP4A7...", recipient: "254 712 ••• 518 (M-Pesa)", amount: 95_000, fee_model: "merchant_covers", status: "pending_approval", created_at: "2026-04-24T06:59:11Z" },
          { id: "pay_01KP4A5...", recipient: "Cooperative 0112 ••• 6614", amount: 820_000, fee_model: "recipient_covers", status: "succeeded", created_at: "2026-04-24T06:40:02Z" },
          { id: "pay_01KP4A3...", recipient: "254 755 ••• 904 (Airtel)", amount: 320_000, fee_model: "merchant_covers", status: "failed", created_at: "2026-04-24T06:21:48Z" },
          { id: "pay_01KP4A1...", recipient: "Equity 0045 ••• 2203", amount: 2_750_000, fee_model: "recipient_covers", status: "succeeded", created_at: "2026-04-24T06:02:33Z" },
        ],
      },
      settlements: {
        available_cents: 140_000_000, // KES 1.4M
        reserved_cents: 18_000_000,
        next_date: "2026-04-27",
        settled_7d_cents: 310_000_000, // KES 3.1M
        daily_balance_cents: [120_000_000, 135_000_000, 118_000_000, 142_000_000, 128_000_000, 151_000_000, 140_000_000],
        recent: [
          { id: "set_01KP4S3...", sub_merchant: "Kwara Savings Cooperative", amount: 86_000_000, currency: "KES", status: "settled", settled_at: "2026-04-23T16:00:00Z" },
          { id: "set_01KP4S2...", sub_merchant: "Kwara SACCO Partners", amount: 42_000_000, currency: "KES", status: "settled", settled_at: "2026-04-22T16:00:00Z" },
          { id: "set_01KP4S1...", sub_merchant: "Kwara Savings Cooperative", amount: 112_000_000, currency: "KES", status: "settled", settled_at: "2026-04-21T16:00:00Z" },
          { id: "set_01KP4RY...", sub_merchant: "Kwara Savings Cooperative", amount: 38_000_000, currency: "KES", status: "scheduled", settled_at: "2026-04-27T16:00:00Z" },
          { id: "set_01KP4RX...", sub_merchant: "Kwara SACCO Partners", amount: 24_000_000, currency: "KES", status: "scheduled", settled_at: "2026-04-27T16:00:00Z" },
        ],
      },
    },
  },
  {
    id: "mrc_01KP0QQXM2HG3Y7X20QKR1M9A",
    legal_name: "M-Kopa Solar Limited",
    trading_name: "M-Kopa",
    registration_number: "PVT-K-2023-00912",
    tax_id: "P051912024M",
    country: "KE",
    settlement_currency: "KES",
    business_category: "utilities",
    website_url: "https://m-kopa.com",
    business_address: "Riverside Drive, Nairobi",
    status: "active",
    created_at: "2026-02-12T08:30:00.000Z",
    updated_at: "2026-04-23T14:05:12.000Z",
    contact_name: "Joyce Mutua",
    contact_email: "payments@m-kopa.com",
    contact_phone: "+254 712 000 912",
    credentials: {
      publishable: "pk_test_mkopa5fy2lhvr83xk7b9",
      secret: "sk_test_mkopa7nq4wcbs1rh8pm6",
      webhook_secret: "whsec_mkopa9tf3dgvx2py8qk4mz",
      issued_at: "2026-02-15T09:00:00.000Z",
    },
    settings: {
      collection_fee_pct: 1.2,
      collection_fee_model: "merchant_covers",
      payout_fee_pct: 0.8,
      payout_fee_model: "merchant_covers",
      settlement_fee_pct: 0.1,
      enabled_methods: ["mpesa", "airtel", "till", "bank"],
      notification_emails: ["payments@m-kopa.com", "finance@m-kopa.com"],
    },
    sub_merchants: [
      { id: "smrc_01KP0QQXM2MK1", name: "M-Kopa Appliances", code: "MKP-001", status: "active", settlement_preference: "daily", settlement_destination: { bank_name: "Stanbic Bank Kenya", account_number: "•••• 1104" } },
      { id: "smrc_01KP0QQXM2MK2", name: "M-Kopa Solar Systems", code: "MKP-002", status: "active", settlement_preference: "daily", settlement_destination: { bank_name: "NCBA Bank", account_number: "•••• 5539" } },
      { id: "smrc_01KP0QQXM2MK3", name: "M-Kopa Insurance", code: "MKP-003", status: "active", settlement_preference: "weekly", settlement_destination: { bank_name: "Equity Bank Kenya", account_number: "•••• 8820" } },
    ],
    activity: {
      collections: {
        tpv_7d_cents: 1_240_000_000, // KES 12.4M
        success_rate: 0.92,
        pending: 28,
        failed: 22,
        daily_tpv_cents: [140_000_000, 165_000_000, 180_000_000, 195_000_000, 210_000_000, 175_000_000, 175_000_000],
        recent: [
          { id: "col_01KP4BM...", method: "mpesa", provider: "safaricom", amount: 8_500_000, fee: 102_000, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T08:12:30Z" },
          { id: "col_01KP4BL...", method: "bank", provider: "paystack", amount: 15_200_000, fee: 182_400, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T07:52:10Z" },
          { id: "col_01KP4BK...", method: "mpesa", provider: "safaricom", amount: 2_100_000, fee: 25_200, business_status: "pending", internal_status: "awaiting_callback", settlement_eligible: false, refund_status: "none", created_at: "2026-04-24T07:30:44Z" },
          { id: "col_01KP4BJ...", method: "airtel", provider: "airtel_money", amount: 4_800_000, fee: 57_600, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T07:02:18Z" },
          { id: "col_01KP4BH...", method: "mpesa", provider: "safaricom", amount: 960_000, fee: 11_520, business_status: "failed", internal_status: "provider_declined", settlement_eligible: false, refund_status: "none", created_at: "2026-04-24T06:45:01Z" },
        ],
      },
      payouts: {
        volume_7d_cents: 890_000_000, // KES 8.9M
        success_rate: 0.97,
        pending: 5,
        reserved_cents: 62_000_000,
        daily_volume_cents: [95_000_000, 118_000_000, 142_000_000, 128_000_000, 155_000_000, 132_000_000, 120_000_000],
        recent: [
          { id: "pay_01KP4CM...", recipient: "Stanbic 0200 ••• 4421", amount: 12_500_000, fee_model: "merchant_covers", status: "succeeded", created_at: "2026-04-24T08:22:15Z" },
          { id: "pay_01KP4CL...", recipient: "254 722 ••• 551 (M-Pesa)", amount: 2_200_000, fee_model: "merchant_covers", status: "processing", created_at: "2026-04-24T08:01:42Z" },
          { id: "pay_01KP4CK...", recipient: "NCBA 0310 ••• 7782", amount: 6_800_000, fee_model: "recipient_covers", status: "succeeded", created_at: "2026-04-24T07:40:08Z" },
          { id: "pay_01KP4CJ...", recipient: "254 755 ••• 920 (Airtel)", amount: 420_000, fee_model: "merchant_covers", status: "failed", created_at: "2026-04-24T07:15:22Z" },
        ],
      },
      settlements: {
        available_cents: 480_000_000, // KES 4.8M
        reserved_cents: 62_000_000,
        next_date: "2026-04-25",
        settled_7d_cents: 1_050_000_000,
        daily_balance_cents: [380_000_000, 420_000_000, 445_000_000, 470_000_000, 490_000_000, 455_000_000, 480_000_000],
        recent: [
          { id: "set_01KP4TM...", sub_merchant: "M-Kopa Appliances", amount: 240_000_000, currency: "KES", status: "settled", settled_at: "2026-04-23T16:00:00Z" },
          { id: "set_01KP4TL...", sub_merchant: "M-Kopa Solar Systems", amount: 180_000_000, currency: "KES", status: "settled", settled_at: "2026-04-23T16:00:00Z" },
          { id: "set_01KP4TK...", sub_merchant: "M-Kopa Appliances", amount: 215_000_000, currency: "KES", status: "scheduled", settled_at: "2026-04-25T16:00:00Z" },
          { id: "set_01KP4TJ...", sub_merchant: "M-Kopa Insurance", amount: 68_000_000, currency: "KES", status: "scheduled", settled_at: "2026-04-28T16:00:00Z" },
        ],
      },
    },
  },
  {
    id: "mrc_01KP0QWPL4HRZ8Y30QKR5S8K3",
    legal_name: "Sendy Logistics Ltd",
    trading_name: "Sendy",
    registration_number: "PVT-K-2021-00331",
    tax_id: "P051331008S",
    country: "KE",
    settlement_currency: "KES",
    business_category: "logistics",
    website_url: "https://sendyit.com",
    business_address: "Wood Avenue, Kilimani, Nairobi",
    status: "active",
    created_at: "2026-01-05T10:15:00.000Z",
    updated_at: "2026-04-22T13:44:08.000Z",
    contact_name: "Mark Kinyanjui",
    contact_email: "ops@sendyit.com",
    contact_phone: "+254 733 000 331",
    credentials: {
      publishable: "pk_test_sendy3xk9mbqv7hf2pt8",
      secret: "sk_test_sendy5nf8wdrt1cy4jm9",
      webhook_secret: "whsec_sendy7pq2vbgz3hy6kx1m",
      issued_at: "2026-01-08T11:00:00.000Z",
    },
    settings: {
      collection_fee_pct: 1.8,
      collection_fee_model: "payer_covers",
      payout_fee_pct: 1.2,
      payout_fee_model: "merchant_covers",
      settlement_fee_pct: 0.15,
      enabled_methods: ["mpesa", "airtel"],
      notification_emails: ["ops@sendyit.com"],
    },
    sub_merchants: [
      { id: "smrc_01KP0QWPL4SD1", name: "Sendy Delivery", code: "SND-001", status: "active", settlement_preference: "weekly", settlement_destination: { bank_name: "KCB Group", account_number: "•••• 3327" } },
    ],
    activity: {
      collections: {
        tpv_7d_cents: 95_000_000, // KES 950k
        success_rate: 0.88,
        pending: 6,
        failed: 14,
        daily_tpv_cents: [8_000_000, 11_000_000, 14_000_000, 18_000_000, 15_000_000, 12_000_000, 17_000_000],
        recent: [
          { id: "col_01KP4EM...", method: "mpesa", provider: "safaricom", amount: 350_000, fee: 6_300, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T07:58:01Z" },
          { id: "col_01KP4EL...", method: "airtel", provider: "airtel_money", amount: 180_000, fee: 3_240, business_status: "successful", internal_status: "ledger_credited", settlement_eligible: true, refund_status: "none", created_at: "2026-04-24T07:15:33Z" },
          { id: "col_01KP4EK...", method: "mpesa", provider: "safaricom", amount: 92_000, fee: 1_656, business_status: "failed", internal_status: "provider_declined", settlement_eligible: false, refund_status: "none", created_at: "2026-04-24T06:48:11Z" },
        ],
      },
      payouts: {
        volume_7d_cents: 42_000_000, // KES 420k
        success_rate: 0.93,
        pending: 1,
        reserved_cents: 3_200_000,
        daily_volume_cents: [3_500_000, 4_800_000, 6_200_000, 7_100_000, 8_900_000, 5_800_000, 5_700_000],
        recent: [
          { id: "pay_01KP4FM...", recipient: "254 722 ••• 118 (M-Pesa)", amount: 140_000, fee_model: "merchant_covers", status: "succeeded", created_at: "2026-04-24T08:12:00Z" },
          { id: "pay_01KP4FL...", recipient: "KCB 0100 ••• 6618", amount: 520_000, fee_model: "merchant_covers", status: "pending_approval", created_at: "2026-04-24T07:44:18Z" },
        ],
      },
      settlements: {
        available_cents: 22_000_000, // KES 220k
        reserved_cents: 3_200_000,
        next_date: "2026-04-28",
        settled_7d_cents: 48_000_000,
        daily_balance_cents: [14_000_000, 16_000_000, 18_000_000, 20_000_000, 22_000_000, 19_000_000, 22_000_000],
        recent: [
          { id: "set_01KP4UM...", sub_merchant: "Sendy Delivery", amount: 22_000_000, currency: "KES", status: "settled", settled_at: "2026-04-21T16:00:00Z" },
          { id: "set_01KP4UL...", sub_merchant: "Sendy Delivery", amount: 26_000_000, currency: "KES", status: "scheduled", settled_at: "2026-04-28T16:00:00Z" },
        ],
      },
    },
  },
];

// Map prototype statuses → backend statuses for badge rendering in the list.
// v1.3.0 prep for the ultrareview rename: we keep the prototype statuses in the
// wizard path but show backend-friendly labels here.
const STATUS_LABEL = {
  draft: "DRAFT",
  kyb_in_progress: "UNDER REVIEW",
  kyb_approved: "APPROVED",
  credentials_issued: "CREDENTIALS ISSUED",
  settings_configured: "CONFIGURING",
  ready_for_activation: "READY",
  active: "ACTIVE",
  rejected: "REJECTED",
  suspended: "SUSPENDED",
  terminated: "TERMINATED",
};

// ----- helpers -------------------------------------------------------------

const genKey = (prefix) => {
  const rnd = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rnd}`;
};

const maskKey = (k) => {
  if (!k) return "";
  if (k.length < 12) return k;
  return k.slice(0, 7) + "•".repeat(Math.max(0, k.length - 11)) + k.slice(-4);
};

const fmtTime = (s) => {
  if (s <= 0) return "0s";
  return `${s}s`;
};

// AI-extracted "ground truth" payloads — these are what would come back from Document AI
// keyed by the doc that produced them
const EXTRACTED_FROM = {
  certificate_of_incorporation: {
    legal_name: "Tamasha Solutions Limited",
    registration_number: "PVT-XYZ123456",
    incorporated_on: "2019-03-14",
  },
  cr12: {
    directors: [
      { name: "Achieng Otieno", id_number: "12345678", role: "Director" },
      { name: "Brian Kamau", id_number: "23456789", role: "Director" },
    ],
  },
  kra_pin: {
    kra_pin: "P051234567X",
  },
  business_address_proof: {
    business_address: "L.R. 209/Block 1/45, Westlands, Nairobi, Kenya",
  },
};

// ----- top-level App -------------------------------------------------------

function App() {
  // merchant state
  const [merchant, setMerchant] = useState({
    id: "mer_001",
    trading_name: "",
    legal_name: "",
    registration_number: "",
    kra_pin: "",
    business_address: "",
    status: "draft",
    incorporated_on: "",
  });

  // sub-merchants — independent mini-flow
  const [subMerchants, setSubMerchants] = useState([
    {
      id: "sub_001",
      display_name: "Tamasha Online Store",
      status: "sub-draft",
      mcc: "5311",
      website_url: "https://shop.tamasha.co.ke",
    },
  ]);

  // documents — file objects keyed by document type
  // each entry: { name, size, status: 'pending' | 'uploaded' | 'flagged' }
  const [documents, setDocuments] = useState({});

  // people — directors and UBOs (a person can be either or both)
  // is_ubo is auto-true when ownership_pct >= 25 (standard compliance threshold)
  const [directors, setDirectors] = useState([
    { id: 1, name: "", is_director: true, is_ubo: true, id_number: "", ownership_pct: 50 },
  ]);

  // settings — grounded in OGUN backend: merchant_settings table (collection_fee_pct,
  // collection_fee_model, payout_fee_pct, payout_fee_model, settlement_fee_pct,
  // notification_emails, enabled_methods text[]) + sub_merchants.settlement_preference
  // / settlement_destination (jsonb { bank_name, account_number, branch_code }).
  // Backend has NO payout_frequency column — payouts are on-demand only.
  // enabled_methods is text[]; "till" is forward-compatible (PK product ask).
  // Payout methods are derived from collections minus card (cards can't receive payouts).
  const [settings, setSettings] = useState({
    // collections — what payers can use to send money in
    collection_fee_pct: 1.5,
    collection_fee_model: "merchant_covers", // merchant_covers | payer_covers
    enabled_methods: { mpesa: true, airtel: true, till: false, card: false, bank: false },
    // payouts — fee model only. No frequency (on-demand per backend POST /v1/payouts).
    // Method enablement is derived from collections minus card.
    payout_fee_pct: 1.0,
    payout_fee_model: "merchant_covers", // merchant_covers | recipient_covers
    payout_max_single_kes: 999999, // operational cap, ops-configurable
    // settlement — sub-merchant level in backend (settlement_preference + settlement_destination)
    settlement_frequency: "weekly", // daily | weekly | monthly | on_demand
    settlement_account_number: "",
    settlement_bank_name: "",
    settlement_fee_kes: 100, // floor: we're charged ~80 KES per settlement
    settlement_currency: "KES",
    // notifications — text[] in backend
    notification_emails: "",
    // ops
    chargeback_handling: "auto",
  });

  // credentials — persistent, masked, with reveal window
  const [credentials, setCredentials] = useState({
    publishable: "",
    secret: "",
    issued_at: null,
  });

  // 30s reveal of the secret (from button click)
  const [revealUntil, setRevealUntil] = useState(0);
  const [revealTick, setRevealTick] = useState(0);

  // pipeline = AI compliance result
  const [pipeline, setPipeline] = useState({ ran: false, ocr: null, rules: null, judgment: null });

  // review decision
  const [review, setReview] = useState({ decision: "", note: "" }); // decision: '', 'approve', 'changes', 'reject'

  // navigation
  const [currentStep, setCurrentStep] = useState(1);
  const [view, setView] = useState("admin"); // admin | merchant
  const [attested, setAttested] = useState(false);
  const [drawerSubId, setDrawerSubId] = useState(null);
  const [demoOpen, setDemoOpen] = useState(true);

  // v1.3.0 routing — 'list' (Compliance list landing), 'onboarding' (wizard),
  // 'panel' (post-activation merchant panel with Settings/Collections/Payouts/Settlements)
  const [route, setRoute] = useState("list");
  const [merchants, setMerchants] = useState(INITIAL_MERCHANTS);
  const [selectedMerchantId, setSelectedMerchantId] = useState(null);
  const [panelTab, setPanelTab] = useState("settings"); // settings | collections | payouts | settlements
  const [settingsSubTab, setSettingsSubTab] = useState("profile"); // profile | accounts | sub_merchants | credentials
  const [panelRevealUntil, setPanelRevealUntil] = useState(0);

  // 30s countdown ticker
  useEffect(() => {
    const id = setInterval(() => setRevealTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const revealRemaining = Math.max(0, Math.ceil((revealUntil - Date.now()) / 1000));
  const revealActive = revealRemaining > 0;

  // ---- propagate doc-driven extraction into merchant + directors ----------
  // Whenever a relevant doc lands in 'uploaded' state, fill the corresponding
  // merchant fields if they are still empty. Admin can still edit afterwards.
  useEffect(() => {
    setMerchant((m) => {
      const next = { ...m };
      if (documents.certificate_of_incorporation?.status === "uploaded") {
        const ex = EXTRACTED_FROM.certificate_of_incorporation;
        if (!next.legal_name) next.legal_name = ex.legal_name;
        if (!next.trading_name) next.trading_name = ex.legal_name; // default trading = legal until edited
        if (!next.registration_number) next.registration_number = ex.registration_number;
        if (!next.incorporated_on) next.incorporated_on = ex.incorporated_on;
      }
      if (documents.kra_pin?.status === "uploaded" && !next.kra_pin) {
        next.kra_pin = EXTRACTED_FROM.kra_pin.kra_pin;
      }
      if (
        documents.business_address_proof?.status === "uploaded" &&
        !next.business_address
      ) {
        next.business_address = EXTRACTED_FROM.business_address_proof.business_address;
      }
      return next;
    });
    if (documents.cr12?.status === "uploaded") {
      setDirectors((cur) => {
        // only auto-extract if the current list is the initial empty single person
        const isEmpty = cur.length === 1 && !cur[0].name && !cur[0].id_number;
        if (!isEmpty) return cur;
        return EXTRACTED_FROM.cr12.directors.map((d, i) => {
          const ownership = i === 0 ? 60 : 40;
          return {
            id: i + 1,
            name: d.name,
            is_director: true,
            is_ubo: ownership >= 25, // auto-flag UBO at the compliance threshold
            id_number: d.id_number,
            ownership_pct: ownership,
          };
        });
      });
    }
  }, [documents]);

  // ---- demo controls ------------------------------------------------------
  const advanceStatus = () => {
    const idx = MERCHANT_STATUSES.indexOf(merchant.status);
    if (idx < 0 || idx >= 6) return; // stop at 'active'
    setMerchant({ ...merchant, status: MERCHANT_STATUSES[idx + 1] });
  };
  const setStatus = (s) => setMerchant({ ...merchant, status: s });
  const reset = () => {
    setMerchant({
      id: "mer_001",
      trading_name: "",
      legal_name: "",
      registration_number: "",
      kra_pin: "",
      business_address: "",
      status: "draft",
      incorporated_on: "",
    });
    setDocuments({});
    setDirectors([
      { id: 1, name: "", is_director: true, is_ubo: true, id_number: "", ownership_pct: 50 },
    ]);
    setSettings({
      collection_fee_pct: 1.5,
      collection_fee_model: "merchant_covers",
      enabled_methods: { mpesa: true, airtel: true, till: false, card: false, bank: false },
      payout_fee_pct: 1.0,
      payout_fee_model: "merchant_covers",
      payout_max_single_kes: 999999,
      settlement_frequency: "weekly",
      settlement_account_number: "",
      settlement_bank_name: "",
      settlement_fee_kes: 100,
      settlement_currency: "KES",
      notification_emails: "",
      chargeback_handling: "auto",
    });
    setCredentials({ publishable: "", secret: "", issued_at: null });
    setPipeline({ ran: false, ocr: null, rules: null, judgment: null });
    setReview({ decision: "", note: "" });
    setRevealUntil(0);
    setAttested(false);
    setCurrentStep(1);
    setSubMerchants([
      {
        id: "sub_001",
        display_name: "Tamasha Online Store",
        status: "sub-draft",
        mcc: "5311",
        website_url: "https://shop.tamasha.co.ke",
      },
    ]);
  };

  // issue credentials when status hits credentials_issued
  useEffect(() => {
    if (
      ["credentials_issued", "settings_configured", "ready_for_activation", "active"].includes(
        merchant.status
      ) &&
      !credentials.publishable
    ) {
      setCredentials({
        publishable: genKey("pk_test"),
        secret: genKey("sk_test"),
        issued_at: new Date().toISOString(),
      });
    }
  }, [merchant.status]);

  const editable = (step) => STEP_EDIT_MATRIX[merchant.status]?.[step] ?? false;

  // ---- per-step render dispatch -------------------------------------------
  // 1=People+Docs, 2=Profile, 3=Settings, 4=AI Compliance, 5=Review, 6=Activate, 7=Sub-merchants
  // PK feedback v1.2.1: every step has a Next CTA so the user can move forward.
  // Sub-merchants (last) has no Next; People & Documents (first) has no Back.
  const goTo = (n) => setCurrentStep(n);
  const renderStep = (onActivate) => {
    switch (currentStep) {
      case 1:
        return (
          <StepPeopleDocuments
            directors={directors}
            setDirectors={setDirectors}
            documents={documents}
            setDocuments={setDocuments}
            editable={editable(1)}
            view={view}
            onNext={() => goTo(2)}
            nextLabel="Continue to Profile →"
          />
        );
      case 2:
        return (
          <Step1Profile
            merchant={merchant}
            setMerchant={setMerchant}
            editable={editable(2)}
            view={view}
            documents={documents}
            onBack={() => goTo(1)}
            onNext={() => goTo(3)}
            nextLabel="Continue to Settings →"
          />
        );
      case 3:
        return (
          <Step4Settings
            settings={settings}
            setSettings={setSettings}
            editable={editable(3)}
            view={view}
            merchant={merchant}
            documents={documents}
            subMerchants={subMerchants}
            setSubMerchants={setSubMerchants}
            openSubDrawer={setDrawerSubId}
            onBack={() => goTo(2)}
            onNext={() => goTo(4)}
            nextLabel="Continue to AI Compliance →"
          />
        );
      case 4:
        return (
          <Step5Compliance
            pipeline={pipeline}
            setPipeline={setPipeline}
            documents={documents}
            view={view}
            merchant={merchant}
            setMerchant={setMerchant}
            onBack={() => goTo(3)}
            onNext={() => goTo(5)}
            nextLabel="Continue to Review →"
          />
        );
      case 5:
        return (
          <Step6Review
            merchant={merchant}
            setMerchant={setMerchant}
            review={review}
            setReview={setReview}
            documents={documents}
            directors={directors}
            pipeline={pipeline}
            view={view}
            editable={editable(5)}
            onBack={() => goTo(4)}
            onNext={() => goTo(6)}
            nextLabel="Continue to Activate →"
          />
        );
      case 6:
        return (
          <Step7Activate
            merchant={merchant}
            setMerchant={setMerchant}
            credentials={credentials}
            attested={attested}
            setAttested={setAttested}
            revealActive={revealActive}
            revealRemaining={revealRemaining}
            startReveal={() => setRevealUntil(Date.now() + 30000)}
            rotateSecret={() =>
              setCredentials({
                ...credentials,
                secret: genKey("sk_test"),
                issued_at: new Date().toISOString(),
              })
            }
            view={view}
            onBack={() => goTo(5)}
            onActivate={onActivate}
          />
        );
      default:
        return null;
    }
  };

  // v1.3.0 — Activate publishes the in-flight merchant into the merchants list
  // and routes the admin to the post-activation panel for that merchant.
  const onActivateLanding = () => {
    const activated = {
      id: merchant.id && merchant.id !== "mer_001" ? merchant.id : `mrc_${Math.random().toString(36).slice(2, 10).toUpperCase()}${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      legal_name: merchant.legal_name || "(unnamed merchant)",
      trading_name: merchant.trading_name || merchant.legal_name || "(unnamed merchant)",
      registration_number: merchant.registration_number || "—",
      tax_id: merchant.kra_pin || "—",
      country: "KE",
      settlement_currency: settings.settlement_currency || "KES",
      business_category: "—",
      website_url: "—",
      business_address: merchant.business_address || "—",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      contact_name: directors[0]?.name || "—",
      contact_email: (settings.notification_emails || "").split(",")[0]?.trim() || "—",
      contact_phone: "—",
      credentials: {
        publishable: credentials.publishable,
        secret: credentials.secret,
        webhook_secret: `whsec_${Math.random().toString(36).slice(2, 14)}`,
        issued_at: credentials.issued_at,
      },
      settings: {
        collection_fee_pct: settings.collection_fee_pct,
        collection_fee_model: settings.collection_fee_model,
        payout_fee_pct: settings.payout_fee_pct,
        payout_fee_model: settings.payout_fee_model,
        settlement_fee_pct: 0.1,
        enabled_methods: Object.entries(settings.enabled_methods || {}).filter(([, v]) => v).map(([k]) => k),
        notification_emails: (settings.notification_emails || "").split(",").map((e) => e.trim()).filter(Boolean),
      },
      sub_merchants: subMerchants.map((s) => ({
        id: s.id,
        name: s.display_name,
        code: s.mcc,
        status: s.status === "sub-active" ? "active" : "draft",
        settlement_preference: settings.settlement_frequency,
        settlement_destination: {
          bank_name: settings.settlement_bank_name || "—",
          account_number: settings.settlement_account_number ? `•••• ${settings.settlement_account_number.slice(-4)}` : "—",
        },
      })),
      activity: {
        collections: { tpv_7d_cents: 0, success_rate: 0, pending: 0, failed: 0, daily_tpv_cents: [0, 0, 0, 0, 0, 0, 0], recent: [] },
        payouts: { volume_7d_cents: 0, success_rate: 0, pending: 0, reserved_cents: 0, daily_volume_cents: [0, 0, 0, 0, 0, 0, 0], recent: [] },
        settlements: { available_cents: 0, reserved_cents: 0, next_date: null, settled_7d_cents: 0, daily_balance_cents: [0, 0, 0, 0, 0, 0, 0], recent: [] },
      },
    };
    // de-dupe by legal_name on replay: if the same merchant is re-activated in the
    // demo (hit "reset" then walk through again), replace in place rather than stack.
    setMerchants((cur) => {
      const exists = cur.findIndex((m) => m.id === activated.id || m.legal_name === activated.legal_name);
      if (exists >= 0) {
        const copy = cur.slice();
        copy[exists] = { ...copy[exists], ...activated };
        return copy;
      }
      return [...cur, activated];
    });
    setSelectedMerchantId(activated.id);
    setRoute("panel");
    setPanelTab("settings");
    setSettingsSubTab("profile");
  };

  const selectedMerchant = merchants.find((m) => m.id === selectedMerchantId) || null;

  // Admin drill-in: click a merchant name inside an aggregated admin view →
  // jump to that merchant's panel, pre-selecting the matching tab.
  const openMerchantFromAdmin = (merchantId, tab) => {
    setSelectedMerchantId(merchantId);
    setPanelTab(tab || "settings");
    setSettingsSubTab("profile");
    setRoute("panel");
  };

  const adminChrome = (content) => (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <TopBar
        merchant={merchant}
        view={view}
        setView={setView}
        toggleDemo={() => setDemoOpen(!demoOpen)}
      />
      {demoOpen && (
        <DemoPanel
          merchant={merchant}
          setStatus={setStatus}
          advanceStatus={advanceStatus}
          reset={reset}
          view={view}
          setView={setView}
          close={() => setDemoOpen(false)}
        />
      )}
      <AdminNav route={route} setRoute={setRoute} />
      {content}
    </div>
  );

  // --- list view (Compliance Review tab) ----------------------------------
  if (route === "list") {
    return adminChrome(
      <ComplianceListView
        merchants={merchants}
        onCreate={() => {
          reset();
          setCurrentStep(1);
          setRoute("onboarding");
        }}
        onRowClick={(m) => {
          setSelectedMerchantId(m.id);
          setPanelTab("settings");
          setSettingsSubTab("profile");
          setRoute("panel");
        }}
      />
    );
  }

  // --- admin aggregated Collections ---------------------------------------
  if (route === "admin_collections") {
    return adminChrome(<AdminCollectionsView merchants={merchants} openMerchant={openMerchantFromAdmin} />);
  }

  // --- admin aggregated Payouts -------------------------------------------
  if (route === "admin_payouts") {
    return adminChrome(<AdminPayoutsView merchants={merchants} openMerchant={openMerchantFromAdmin} />);
  }

  // --- admin aggregated Settlements ---------------------------------------
  if (route === "admin_settlements") {
    return adminChrome(<AdminSettlementsView merchants={merchants} openMerchant={openMerchantFromAdmin} />);
  }

  // --- post-activation panel ---------------------------------------------
  if (route === "panel" && selectedMerchant) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopBar
          merchant={merchant}
          view={view}
          setView={setView}
          toggleDemo={() => setDemoOpen(!demoOpen)}
        />
        {demoOpen && (
          <DemoPanel
            merchant={merchant}
            setStatus={setStatus}
            advanceStatus={advanceStatus}
            reset={reset}
            view={view}
            setView={setView}
            close={() => setDemoOpen(false)}
          />
        )}
        <MerchantPanel
          merchant={selectedMerchant}
          updateMerchant={(patch) =>
            setMerchants((cur) => cur.map((m) => (m.id === selectedMerchant.id ? { ...m, ...patch } : m)))
          }
          panelTab={panelTab}
          setPanelTab={setPanelTab}
          settingsSubTab={settingsSubTab}
          setSettingsSubTab={setSettingsSubTab}
          revealUntil={panelRevealUntil}
          startReveal={() => setPanelRevealUntil(Date.now() + 30000)}
          revealRemaining={Math.max(0, Math.ceil((panelRevealUntil - Date.now()) / 1000))}
          onBack={() => setRoute("list")}
        />
      </div>
    );
  }

  // --- onboarding wizard (existing build) --------------------------------
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <TopBar
        merchant={merchant}
        view={view}
        setView={setView}
        toggleDemo={() => setDemoOpen(!demoOpen)}
      />
      {demoOpen && (
        <DemoPanel
          merchant={merchant}
          setStatus={setStatus}
          advanceStatus={advanceStatus}
          reset={reset}
          view={view}
          setView={setView}
          close={() => setDemoOpen(false)}
        />
      )}
      <div className="max-w-6xl mx-auto px-6 pt-4">
        <button
          onClick={() => setRoute("list")}
          className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
        >
          ← Back to merchants
        </button>
      </div>
      <JourneyBar currentStep={currentStep} setCurrentStep={setCurrentStep} merchantStatus={merchant.status} />
      <main className="max-w-6xl mx-auto p-6">{renderStep(onActivateLanding)}</main>

      {drawerSubId && (
        <SubMerchantDrawer
          sub={subMerchants.find((s) => s.id === drawerSubId)}
          setSubMerchants={setSubMerchants}
          subMerchants={subMerchants}
          close={() => setDrawerSubId(null)}
          merchantStatus={merchant.status}
        />
      )}
    </div>
  );
}

// ----- TopBar / Demo / Journey --------------------------------------------

function TopBar({ merchant, view, setView, toggleDemo }) {
  return (
    <header className="bg-slate-900 border-b border-slate-700 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-indigo-500 text-white grid place-items-center font-bold text-sm">
            O
          </div>
          <div className="font-semibold">Ogun</div>
          <span className="text-slate-600">·</span>
          <div className="text-sm text-slate-400">Onboarding prototype</div>
        </div>
        <div className="flex items-center gap-2 text-sm ml-4">
          <div className="text-slate-400">Merchant:</div>
          <div className="font-mono text-slate-300">{merchant.id}</div>
          <div className="text-slate-500">·</div>
          <div className="text-slate-300">{merchant.legal_name || merchant.trading_name || "—"}</div>
          <span className={`ml-2 px-2 py-0.5 rounded-full border text-xs ${STATUS_TINT[merchant.status]}`}>
            {merchant.status}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <div className="inline-flex bg-slate-800 rounded-md p-0.5">
            <button
              className={`px-2 py-1 rounded ${view === "admin" ? "bg-slate-900 shadow text-slate-100" : "text-slate-400"}`}
              onClick={() => setView("admin")}
            >
              Admin
            </button>
            <button
              className={`px-2 py-1 rounded ${view === "merchant" ? "bg-slate-900 shadow text-slate-100" : "text-slate-400"}`}
              onClick={() => setView("merchant")}
            >
              Merchant
            </button>
          </div>
          <button
            onClick={toggleDemo}
            className="px-2 py-1 text-xs text-slate-400 border border-slate-700 rounded hover:bg-slate-800"
          >
            Demo controls
          </button>
        </div>
      </div>
    </header>
  );
}

function DemoPanel({ merchant, setStatus, advanceStatus, reset, view, setView, close }) {
  return (
    <div className="bg-amber-900/30/70 border-b border-amber-700/50">
      <div className="max-w-6xl mx-auto px-6 py-2 flex items-center gap-3 text-sm">
        <span className="font-medium text-amber-100">Demo</span>
        <button
          onClick={advanceStatus}
          className="px-2 py-1 rounded bg-slate-900 border border-amber-600/60 text-amber-100 hover:bg-amber-900/50 text-xs"
        >
          Advance status →
        </button>
        <select
          value={merchant.status}
          onChange={(e) => setStatus(e.target.value)}
          className="text-xs border border-amber-600/60 rounded bg-slate-900 px-2 py-1"
        >
          {MERCHANT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          onClick={reset}
          className="px-2 py-1 rounded bg-slate-900 border border-amber-600/60 text-amber-100 hover:bg-amber-900/50 text-xs"
        >
          Reset
        </button>
        <span className="text-amber-200/70 text-xs ml-2">
          Tip: status drives which fields are editable on each step.
        </span>
        <button onClick={close} className="ml-auto text-amber-300 text-xs">
          Hide
        </button>
      </div>
    </div>
  );
}

function JourneyBar({ currentStep, setCurrentStep, merchantStatus }) {
  return (
    <nav className="bg-slate-900 border-b border-slate-700">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-1 overflow-x-auto">
        {STEPS.map((s) => {
          const active = s.id === currentStep;
          const cls = active
            ? "bg-indigo-500 text-white"
            : "bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-700";
          return (
            <button
              key={s.id}
              onClick={() => setCurrentStep(s.id)}
              className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap ${cls}`}
            >
              <span className="font-mono text-xs opacity-70 mr-1.5">{s.id}</span>
              {s.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ----- Step 1 — Profile ----------------------------------------------------

function Step1Profile({ merchant, setMerchant, editable, view, documents, onBack, onNext, nextLabel }) {
  const lock = !editable && view === "merchant";
  const lockReason =
    view === "merchant" && !editable
      ? `These fields are read-only after submission (status: ${merchant.status}). Contact your account manager to edit.`
      : null;

  // Which fields are auto-extracted vs. typed?
  const extractionStatus = useMemo(() => {
    return {
      legal_name: documents.certificate_of_incorporation?.status === "uploaded" ? "auto" : "pending",
      trading_name: documents.certificate_of_incorporation?.status === "uploaded" ? "auto" : "pending",
      registration_number:
        documents.certificate_of_incorporation?.status === "uploaded" ? "auto" : "pending",
      kra_pin: documents.kra_pin?.status === "uploaded" ? "auto" : "pending",
      business_address:
        documents.business_address_proof?.status === "uploaded" ? "auto" : "pending",
      incorporated_on:
        documents.certificate_of_incorporation?.status === "uploaded" ? "auto" : "pending",
    };
  }, [documents]);

  const allExtracted = Object.values(extractionStatus).every((s) => s === "auto");
  const noneExtracted = Object.values(extractionStatus).every((s) => s === "pending");

  // Next is enabled when required identity fields are present (typed or extracted)
  const profileOk =
    !!merchant.legal_name &&
    !!merchant.registration_number &&
    !!merchant.kra_pin &&
    !!merchant.country;
  const nextHint = profileOk
    ? "Identity and registration captured"
    : "Fill in (or extract via Step 1 upload) legal name, registration number, KRA PIN, country";

  return (
    <StepShell
      title="Profile"
      subtitle="Identity, registration, and where the business operates"
      view={view}
      onBack={onBack}
      onNext={onNext}
      nextLabel={nextLabel}
      nextDisabled={!profileOk}
      nextHint={nextHint}
    >
      {noneExtracted && (
        <Banner kind="info">
          <div className="font-medium text-sm">Profile fields are auto-filled from your documents</div>
          <div className="text-xs text-slate-400 mt-1">
            Upload your Certificate of Incorporation, KRA PIN, and business address proof on Step 1 — Document AI will read
            them and fill these fields. You won't need to type any of this.
          </div>
        </Banner>
      )}
      {!noneExtracted && !allExtracted && (
        <Banner kind="warn">
          <div className="font-medium text-sm">Some fields still need a document</div>
          <div className="text-xs text-slate-400 mt-1">
            Fields marked <span className="font-medium">Pending upload</span> will fill in once the matching document is
            uploaded on Step 1.
          </div>
        </Banner>
      )}
      {allExtracted && (
        <Banner kind="ok">
          <div className="font-medium text-sm">All profile fields extracted from your uploaded documents</div>
          <div className="text-xs text-slate-400 mt-1">
            Review for accuracy. Admins can correct any extraction error inline.
          </div>
        </Banner>
      )}
      {lockReason && <Banner kind="info">{lockReason}</Banner>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <ExtractedField
          label="Legal name"
          value={merchant.legal_name}
          onChange={(v) => setMerchant({ ...merchant, legal_name: v })}
          disabled={lock || (view === "merchant" && extractionStatus.legal_name === "pending")}
          status={extractionStatus.legal_name}
          source="Certificate of Incorporation"
          editableInAdmin={view === "admin"}
        />
        <ExtractedField
          label="Trading name (DBA)"
          value={merchant.trading_name}
          onChange={(v) => setMerchant({ ...merchant, trading_name: v })}
          disabled={lock}
          status={extractionStatus.trading_name}
          source="Certificate of Incorporation (defaults to legal name)"
          editableInAdmin={true}
          help="Edit if the brand differs from the legal entity"
        />
        <ExtractedField
          label="Registration number"
          value={merchant.registration_number}
          onChange={(v) => setMerchant({ ...merchant, registration_number: v })}
          disabled={lock || (view === "merchant" && extractionStatus.registration_number === "pending")}
          status={extractionStatus.registration_number}
          source="Certificate of Incorporation"
          editableInAdmin={view === "admin"}
        />
        <ExtractedField
          label="KRA PIN"
          value={merchant.kra_pin}
          onChange={(v) => setMerchant({ ...merchant, kra_pin: v })}
          disabled={lock || (view === "merchant" && extractionStatus.kra_pin === "pending")}
          status={extractionStatus.kra_pin}
          source="KRA PIN certificate"
          editableInAdmin={view === "admin"}
        />
        <ExtractedField
          label="Business address"
          value={merchant.business_address}
          onChange={(v) => setMerchant({ ...merchant, business_address: v })}
          disabled={lock || (view === "merchant" && extractionStatus.business_address === "pending")}
          status={extractionStatus.business_address}
          source="Utility bill / lease agreement"
          editableInAdmin={view === "admin"}
        />
        <ExtractedField
          label="Incorporated on"
          value={merchant.incorporated_on}
          onChange={(v) => setMerchant({ ...merchant, incorporated_on: v })}
          disabled={lock || (view === "merchant" && extractionStatus.incorporated_on === "pending")}
          status={extractionStatus.incorporated_on}
          source="Certificate of Incorporation"
          editableInAdmin={view === "admin"}
        />
      </div>
    </StepShell>
  );
}

function ExtractedField({ label, value, onChange, disabled, status, source, editableInAdmin, help }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="text-sm text-slate-300 font-medium">{label}</label>
        {status === "auto" && (
          <span className="text-[10px] uppercase tracking-wide bg-emerald-900/30 text-emerald-300 border border-emerald-700/50 rounded px-1.5 py-0.5">
            Auto-filled
          </span>
        )}
        {status === "pending" && (
          <span className="text-[10px] uppercase tracking-wide bg-slate-800 text-slate-400 border border-slate-700 rounded px-1.5 py-0.5">
            Pending upload
          </span>
        )}
      </div>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={status === "pending" ? "Will appear after document upload" : ""}
        className={`w-full px-3 py-2 border rounded-md text-sm ${
          disabled ? "bg-slate-950 text-slate-400 border-slate-700" : "border-slate-600 bg-slate-900"
        }`}
      />
      <div className="text-xs text-slate-500 mt-1">
        {help ? `${help} · ` : ""}Source: {source}
        {editableInAdmin && status === "auto" ? " · Editable for correction" : ""}
      </div>
    </div>
  );
}

// ----- Step 2 — Directors --------------------------------------------------

// Unified person row used by Step 2 (data) and Step 3 (ID upload). Renders the same
// header (name + role badges) so both views feel like the same surface.
function personRoleLabel(p) {
  const ubo = p.is_ubo || (Number(p.ownership_pct) || 0) >= 25;
  if (p.is_director && ubo) return "Director & UBO";
  if (p.is_director) return "Director";
  if (ubo) return "UBO";
  return "Person";
}

function PersonHeader({ person, index }) {
  const role = personRoleLabel(person);
  const tint =
    role === "Director & UBO"
      ? "bg-indigo-900/30 text-indigo-300 border-indigo-700/50"
      : role === "Director"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : role === "UBO"
      ? "bg-amber-900/30 text-amber-200 border-amber-700/50"
      : "bg-slate-950 text-slate-400 border-slate-700";
  return (
    <div className="flex items-center gap-2">
      <div className="font-medium text-sm text-slate-300">{person.name || `Person ${index + 1}`}</div>
      <span className={`text-[10px] uppercase tracking-wide rounded border px-1.5 py-0.5 ${tint}`}>
        {role}
      </span>
    </div>
  );
}

// ----- Step 1 — People & Documents (merged) -------------------------------
// PK feedback: Director & UBO + Document share the same view (one step, not two)
// because directors are materialized from director_id documents on the backend
// (documents.type = 'director_id'). UBO is auto-flagged at >=25% per compliance.
// Backend grounding: documents.type enum includes director_id; merchants.tax_id
// and registration_number are auto-extracted from cert + KRA PIN docs.
function StepPeopleDocuments({ directors, setDirectors, documents, setDocuments, editable, view, onBack, onNext, nextLabel }) {
  const lock = !editable && view === "merchant";

  // people management (mirrors Step2Directors logic so it's the SAME view PK asked for)
  const updPerson = (id, patch) => {
    setDirectors(
      directors.map((d) => {
        if (d.id !== id) return d;
        const next = { ...d, ...patch };
        if ("ownership_pct" in patch) {
          const pct = Number(patch.ownership_pct) || 0;
          if (pct >= 25) next.is_ubo = true;
        }
        return next;
      })
    );
  };
  const addPerson = () =>
    setDirectors([
      ...directors,
      {
        id: Math.max(0, ...directors.map((d) => d.id)) + 1,
        name: "",
        is_director: true,
        is_ubo: false,
        id_number: "",
        ownership_pct: 0,
      },
    ]);
  const removePerson = (id) => setDirectors(directors.filter((d) => d.id !== id));

  // document management (same logic as Step3Documents)
  const onPickDoc = (docKey, file) => {
    if (!file) return;
    setDocuments({
      ...documents,
      [docKey]: { name: file.name, size: file.size, status: "uploaded" },
    });
  };
  const onPickDirectorId = (directorId, file) => {
    if (!file) return;
    setDocuments({
      ...documents,
      [`director_id_${directorId}`]: { name: file.name, size: file.size, status: "uploaded" },
    });
  };
  const removeDoc = (key) => {
    const next = { ...documents };
    delete next[key];
    setDocuments(next);
  };

  const totalOwnership = directors.reduce((sum, d) => sum + (Number(d.ownership_pct) || 0), 0);
  const ownershipOk = totalOwnership === 100;
  const uboCount = directors.filter((d) => d.is_ubo || (Number(d.ownership_pct) || 0) >= 25).length;

  // Next-CTA gating: at minimum require company docs uploaded + at least one director
  const requiredCompanyDocs = ["certificate_of_incorporation", "kra_pin", "cr12", "business_address_proof"];
  const docsOk = requiredCompanyDocs.every((k) => documents[k]);
  const peopleOk = directors.length > 0 && ownershipOk;
  const peopleIdsOk = directors.every((d) => documents[`director_id_${d.id}`]);
  const canContinue = docsOk && peopleOk && peopleIdsOk;
  const nextHint = canContinue
    ? "All required documents and people captured"
    : "Upload required company docs, ensure ownership totals 100%, and attach each person's ID";

  return (
    <StepShell
      title="People & Documents"
      subtitle="Upload company documents and add directors and ultimate beneficial owners (UBOs) — one consolidated view"
      view={view}
      onBack={onBack}
      onNext={onNext}
      nextLabel={nextLabel}
      nextDisabled={!canContinue}
      nextHint={nextHint}
    >
      {lock && <Banner kind="info">Read-only after submission. Contact your account manager to edit.</Banner>}

      <Banner kind="info">
        <div className="font-medium text-sm">How this step works</div>
        <div className="text-xs text-slate-400 mt-1">
          Upload documents below — Document AI extracts the data and pre-fills your Profile (next step).
          List every Director and every shareholder ≥25% (auto-flagged as UBO). Each person needs an ID upload.
        </div>
      </Banner>

      {/* --- Company documents --- */}
      <div className="mt-4">
        <h3 className="font-semibold text-slate-200 text-sm mb-1">Company documents</h3>
        <div className="text-xs text-slate-400 mb-2">
          AI extracts: legal name · registration number · KRA PIN · business address · incorporation date
        </div>
        <div className="space-y-2">
          {DOC_TYPES.map((d) => (
            <DocRow
              key={d.key}
              doc={d}
              entry={documents[d.key]}
              onPick={(file) => onPickDoc(d.key, file)}
              onRemove={() => removeDoc(d.key)}
              disabled={lock}
            />
          ))}
        </div>
      </div>

      {/* --- People (Directors & UBOs) with their IDs inline --- */}
      <div className="mt-6">
        <h3 className="font-semibold text-slate-200 text-sm mb-1">Directors & UBOs</h3>
        <div className="text-xs text-slate-400 mb-2">
          A person can be Director, UBO, or both. UBO is auto-flagged at ≥25% ownership (Kenya AML / FATF standard).
          Upload each person's National ID or Passport.
        </div>
        <div className="space-y-3">
          {directors.map((d, i) => {
            const idDocKey = `director_id_${d.id}`;
            const role = personRoleLabel(d);
            return (
              <div key={d.id} className="border border-slate-700 rounded-lg p-3 bg-slate-900">
                <div className="flex items-center justify-between mb-3">
                  <PersonHeader person={d} index={i} />
                  {directors.length > 1 && !lock && (
                    <button onClick={() => removePerson(d.id)} className="text-xs text-rose-400 hover:underline">
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Field
                    label="Full name"
                    value={d.name}
                    onChange={(v) => updPerson(d.id, { name: v })}
                    disabled={lock}
                  />
                  <Field
                    label="National ID / Passport #"
                    value={d.id_number}
                    onChange={(v) => updPerson(d.id, { id_number: v })}
                    disabled={lock}
                  />
                  <Field
                    label="Ownership %"
                    type="number"
                    value={d.ownership_pct}
                    onChange={(v) => updPerson(d.id, { ownership_pct: Number(v) || 0 })}
                    disabled={lock}
                  />
                </div>

                <div className="mt-3 flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={d.is_director}
                      onChange={(e) => updPerson(d.id, { is_director: e.target.checked })}
                      disabled={lock}
                    />
                    <span>Director</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={d.is_ubo || (Number(d.ownership_pct) || 0) >= 25}
                      onChange={(e) => updPerson(d.id, { is_ubo: e.target.checked })}
                      disabled={lock || (Number(d.ownership_pct) || 0) >= 25}
                    />
                    <span>
                      UBO
                      {(Number(d.ownership_pct) || 0) >= 25 && (
                        <span className="text-xs text-slate-500 ml-1">(auto: ≥25% ownership)</span>
                      )}
                    </span>
                  </label>
                </div>

                {/* ID upload inline with the person — same view, not a separate step */}
                <div className="mt-3 pt-3 border-t border-slate-800">
                  <div className="text-xs text-slate-400 mb-1">ID document for this {role}</div>
                  <DocRow
                    doc={{
                      key: idDocKey,
                      label: `National ID or Passport — ${d.name || `Person ${i + 1}`}`,
                      required: true,
                      fills: "ID verification",
                    }}
                    entry={documents[idDocKey]}
                    onPick={(file) => onPickDirectorId(d.id, file)}
                    onRemove={() => removeDoc(idDocKey)}
                    disabled={lock}
                  />
                </div>
              </div>
            );
          })}
          {!lock && (
            <button
              onClick={addPerson}
              className="text-sm border border-dashed border-slate-600 hover:border-slate-500 rounded-md px-3 py-2 w-full text-slate-400 hover:bg-slate-800"
            >
              + Add another director or UBO
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div
            className={`text-sm px-3 py-2 rounded border ${
              ownershipOk
                ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-200"
                : "border-amber-700/50 bg-amber-900/30 text-amber-200"
            }`}
          >
            Total ownership: <span className="font-semibold">{totalOwnership}%</span>{" "}
            {ownershipOk ? "✓ matches 100%" : "— must add up to 100% before submission"}
          </div>
          <div className="text-sm px-3 py-2 rounded border border-slate-700 bg-slate-950 text-slate-300">
            {uboCount} UBO(s) declared. Compliance requires every shareholder ≥25% to be listed.
          </div>
        </div>
      </div>
    </StepShell>
  );
}

function Step2Directors({ directors, setDirectors, editable, view }) {
  const lock = !editable && view === "merchant";
  const update = (id, patch) => {
    setDirectors(
      directors.map((d) => {
        if (d.id !== id) return d;
        const next = { ...d, ...patch };
        // auto-flag UBO at the 25% compliance threshold (admin/merchant can still uncheck if it's a nominee)
        if ("ownership_pct" in patch) {
          const pct = Number(patch.ownership_pct) || 0;
          if (pct >= 25) next.is_ubo = true;
        }
        return next;
      })
    );
  };
  const add = () =>
    setDirectors([
      ...directors,
      {
        id: Math.max(0, ...directors.map((d) => d.id)) + 1,
        name: "",
        is_director: true,
        is_ubo: false,
        id_number: "",
        ownership_pct: 0,
      },
    ]);
  const remove = (id) => setDirectors(directors.filter((d) => d.id !== id));

  const totalOwnership = directors.reduce((sum, d) => sum + (Number(d.ownership_pct) || 0), 0);
  const ownershipOk = totalOwnership === 100;
  const uboCount = directors.filter((d) => d.is_ubo || (Number(d.ownership_pct) || 0) >= 25).length;

  return (
    <StepShell
      title="Directors & Ultimate Beneficial Owners"
      subtitle="Same view for both — a person can be a Director, a UBO, or both. UBO is auto-flagged at ≥25% ownership."
      view={view}
    >
      {lock && (
        <Banner kind="info">
          Read-only after submission (status: kyb-locked). Contact your account manager to edit.
        </Banner>
      )}
      <div className="space-y-3 mt-2">
        {directors.map((d, i) => (
          <div key={d.id} className="border border-slate-700 rounded-lg p-3 bg-slate-900">
            <div className="flex items-center justify-between mb-3">
              <PersonHeader person={d} index={i} />
              {directors.length > 1 && !lock && (
                <button onClick={() => remove(d.id)} className="text-xs text-rose-400 hover:underline">
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field
                label="Full name"
                value={d.name}
                onChange={(v) => update(d.id, { name: v })}
                disabled={lock}
              />
              <Field
                label="National ID / Passport #"
                value={d.id_number}
                onChange={(v) => update(d.id, { id_number: v })}
                disabled={lock}
              />
              <Field
                label="Ownership %"
                type="number"
                value={d.ownership_pct}
                onChange={(v) => update(d.id, { ownership_pct: Number(v) || 0 })}
                disabled={lock}
              />
            </div>

            <div className="mt-3 flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={d.is_director}
                  onChange={(e) => update(d.id, { is_director: e.target.checked })}
                  disabled={lock}
                />
                <span>Director</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={d.is_ubo || (Number(d.ownership_pct) || 0) >= 25}
                  onChange={(e) => update(d.id, { is_ubo: e.target.checked })}
                  disabled={lock || (Number(d.ownership_pct) || 0) >= 25}
                />
                <span>
                  UBO
                  {(Number(d.ownership_pct) || 0) >= 25 && (
                    <span className="text-xs text-slate-500 ml-1">(auto: ≥25% ownership)</span>
                  )}
                </span>
              </label>
            </div>
          </div>
        ))}
        {!lock && (
          <button
            onClick={add}
            className="text-sm border border-dashed border-slate-600 hover:border-slate-500 rounded-md px-3 py-2 w-full text-slate-400 hover:bg-slate-800"
          >
            + Add another director or UBO
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div
          className={`text-sm px-3 py-2 rounded border ${
            ownershipOk
              ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-200"
              : "border-amber-700/50 bg-amber-900/30 text-amber-200"
          }`}
        >
          Total ownership: <span className="font-semibold">{totalOwnership}%</span>{" "}
          {ownershipOk ? "✓ matches 100%" : "— must add up to 100% before submission"}
        </div>
        <div className="text-sm px-3 py-2 rounded border border-slate-700 bg-slate-950 text-slate-300">
          {uboCount} UBO(s) declared. Compliance requires every shareholder ≥25% to be listed.
        </div>
      </div>
    </StepShell>
  );
}

// ----- Step 3 — Documents --------------------------------------------------

const DOC_TYPES = [
  { key: "certificate_of_incorporation", label: "Certificate of Incorporation", required: true, fills: "Legal name · Reg # · Incorporation date" },
  { key: "cr12", label: "CR12 (Director list)", required: true, fills: "Directors auto-populated on Step 2" },
  { key: "kra_pin", label: "KRA PIN certificate", required: true, fills: "KRA PIN" },
  { key: "business_address_proof", label: "Business address proof", required: true, fills: "Business address (utility bill / lease)" },
  { key: "bank_statement", label: "Bank statement (last 3 months)", required: true, fills: "Settlement account verification" },
];

function Step3Documents({ documents, setDocuments, directors, editable, view }) {
  const lock = !editable && view === "merchant";

  const onPick = (docKey, file) => {
    if (!file) return;
    setDocuments({
      ...documents,
      [docKey]: { name: file.name, size: file.size, status: "uploaded" },
    });
  };
  const onPickDirectorId = (directorId, file) => {
    if (!file) return;
    setDocuments({
      ...documents,
      [`director_id_${directorId}`]: { name: file.name, size: file.size, status: "uploaded" },
    });
  };
  const remove = (key) => {
    const next = { ...documents };
    delete next[key];
    setDocuments(next);
  };

  return (
    <StepShell
      title="Documents"
      subtitle="Upload identity, ownership, and bank documents — Document AI extracts the data"
      view={view}
    >
      {lock && <Banner kind="info">Read-only after submission. New documents must be requested from admin.</Banner>}
      <div className="space-y-2 mt-2">
        {DOC_TYPES.map((d) => (
          <DocRow
            key={d.key}
            doc={d}
            entry={documents[d.key]}
            onPick={(file) => onPick(d.key, file)}
            onRemove={() => remove(d.key)}
            disabled={lock}
          />
        ))}
        <div className="pt-3">
          <div className="text-sm font-medium text-slate-300 mb-1">Director & UBO ID documents</div>
          <div className="text-xs text-slate-400 mb-2">
            One ID per person listed on Step 2. Same view — Directors and UBOs both upload here.
          </div>
          <div className="space-y-2">
            {directors.map((dir, i) => {
              const key = `director_id_${dir.id}`;
              const role = personRoleLabel(dir);
              return (
                <div key={key} className="border border-slate-700 rounded-lg bg-slate-900 p-3">
                  <div className="mb-2">
                    <PersonHeader person={dir} index={i} />
                  </div>
                  <DocRow
                    doc={{
                      key,
                      label: `National ID or Passport — ${role}`,
                      required: true,
                      fills: "ID verification · selfie match",
                    }}
                    entry={documents[key]}
                    onPick={(file) => onPickDirectorId(dir.id, file)}
                    onRemove={() => remove(key)}
                    disabled={lock}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </StepShell>
  );
}

function DocRow({ doc, entry, onPick, onRemove, disabled }) {
  const inputRef = useRef(null);
  const status = entry?.status || "missing";

  return (
    <div className="flex items-center gap-3 border border-slate-700 rounded-lg px-3 py-2 bg-slate-900">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm text-slate-200 truncate">{doc.label}</div>
          {doc.required && (
            <span className="text-[10px] uppercase tracking-wide text-rose-300 bg-rose-900/30 border border-rose-700/50 rounded px-1.5">
              Required
            </span>
          )}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">{doc.fills}</div>
        {entry && (
          <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
            <span className="font-mono">{entry.name}</span>
            <span className="text-slate-500">·</span>
            <span>{Math.round((entry.size || 0) / 1024)} KB</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {status === "uploaded" && (
          <span className="text-[10px] uppercase tracking-wide bg-emerald-900/30 text-emerald-300 border border-emerald-700/50 rounded px-1.5 py-0.5">
            Uploaded
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = ""; // allow re-pick of same file
          }}
        />
        {!disabled && (
          <button
            onClick={() => inputRef.current?.click()}
            className="text-xs px-2.5 py-1.5 rounded border border-slate-600 hover:bg-slate-800"
          >
            {entry ? "Replace" : "Upload"}
          </button>
        )}
        {entry && !disabled && (
          <button
            onClick={onRemove}
            className="text-xs px-2 py-1.5 rounded border border-slate-700 text-slate-400 hover:bg-slate-800"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ----- Step 4 — Settings ---------------------------------------------------

function Step4Settings({
  settings,
  setSettings,
  editable,
  view,
  merchant,
  documents,
  subMerchants,
  setSubMerchants,
  openSubDrawer,
  onBack,
  onNext,
  nextLabel,
}) {
  const lock = !editable && view === "merchant";
  const fee = Number(settings.settlement_fee_kes) || 0;
  const feeOk = fee >= 100;

  const upd = (patch) => setSettings({ ...settings, ...patch });
  const updMethod = (method, on) =>
    setSettings({
      ...settings,
      enabled_methods: { ...settings.enabled_methods, [method]: on },
    });

  const enabledCount = Object.values(settings.enabled_methods).filter(Boolean).length;

  // Payout methods are derived from collection methods MINUS cards (PK rule:
  // "we can not offer payout to cards"). Backend confirms: payouts.method enum
  // is mobile_money | bank_transfer | demo — no card payouts exist.
  const payoutEligible = {
    mpesa: settings.enabled_methods.mpesa,
    airtel: settings.enabled_methods.airtel,
    till: settings.enabled_methods.till,
    bank: settings.enabled_methods.bank,
    // card is intentionally excluded
  };
  const payoutEligibleCount = Object.values(payoutEligible).filter(Boolean).length;

  // Next gating: at least one collection method enabled AND settlement destination set
  const settingsOk =
    enabledCount > 0 &&
    !!settings.settlement_frequency &&
    !!settings.settlement_bank_name &&
    !!settings.settlement_account_number;
  const nextHint = settingsOk
    ? "Methods and settlement destination configured"
    : "Enable at least one collection method and complete settlement bank details";

  return (
    <StepShell
      title="Settings"
      subtitle="Collections, payouts, settlement, payment methods, and notifications"
      view={view}
      onBack={onBack}
      onNext={onNext}
      nextLabel={nextLabel}
      nextDisabled={!settingsOk}
      nextHint={nextHint}
    >
      {lock && (
        <Banner kind="info">Settings are managed by admin. Contact your account manager to request a change.</Banner>
      )}

      {/* Collections section */}
      <SettingsSection
        title="Collections"
        hint="Fees on money coming in from payers. Defaults: 1.5% merchant_covers."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-300 font-medium">Collection fee (%)</label>
            <div className="flex items-stretch mt-1">
              <input
                type="number"
                min={0}
                step={0.1}
                value={settings.collection_fee_pct}
                onChange={(e) => upd({ collection_fee_pct: Number(e.target.value) || 0 })}
                disabled={lock}
                className="flex-1 px-3 py-2 border border-slate-600 rounded-l-md text-sm bg-slate-900 disabled:bg-slate-800"
              />
              <span className="px-3 inline-flex items-center bg-slate-800 border border-l-0 border-slate-600 rounded-r-md text-sm text-slate-400">
                %
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">Per successful collection (snapshot at create time)</div>
          </div>
          <div>
            <label className="text-sm text-slate-300 font-medium">Who pays the collection fee</label>
            <div className="mt-1 inline-flex bg-slate-800 rounded-md p-0.5 w-full">
              <button
                onClick={() => upd({ collection_fee_model: "merchant_covers" })}
                disabled={lock}
                className={`flex-1 px-3 py-1.5 rounded text-sm ${
                  settings.collection_fee_model === "merchant_covers"
                    ? "bg-slate-900 shadow text-slate-100"
                    : "text-slate-400"
                } disabled:opacity-50`}
              >
                Merchant covers
              </button>
              <button
                onClick={() => upd({ collection_fee_model: "payer_covers" })}
                disabled={lock}
                className={`flex-1 px-3 py-1.5 rounded text-sm ${
                  settings.collection_fee_model === "payer_covers"
                    ? "bg-slate-900 shadow text-slate-100"
                    : "text-slate-400"
                } disabled:opacity-50`}
              >
                Payer covers
              </button>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {settings.collection_fee_model === "merchant_covers"
                ? "Fee deducted from merchant balance — payer sees the full amount"
                : "Fee added on top — payer sees amount + fee at checkout"}
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* Payment methods section — collection rails */}
      <SettingsSection
        title="Collection payment methods"
        hint="Which rails the merchant can accept from payers. Defaults: M-Pesa + Airtel Money. Backend stores as merchant_settings.enabled_methods text[]."
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <MethodToggle
            label="M-Pesa"
            on={settings.enabled_methods.mpesa}
            onChange={(v) => updMethod("mpesa", v)}
            disabled={lock}
            badge="Default"
          />
          <MethodToggle
            label="Airtel Money"
            on={settings.enabled_methods.airtel}
            onChange={(v) => updMethod("airtel", v)}
            disabled={lock}
            badge="Default"
          />
          <MethodToggle
            label="Till (Lipa Na M-Pesa)"
            on={settings.enabled_methods.till}
            onChange={(v) => updMethod("till", v)}
            disabled={lock}
            badge="KE"
          />
          <MethodToggle
            label="Card"
            on={settings.enabled_methods.card}
            onChange={(v) => updMethod("card", v)}
            disabled={lock}
          />
          <MethodToggle
            label="Bank transfer"
            on={settings.enabled_methods.bank}
            onChange={(v) => updMethod("bank", v)}
            disabled={lock}
          />
        </div>
        <div
          className={`text-xs mt-2 ${
            enabledCount > 0 ? "text-slate-400" : "text-rose-400"
          }`}
        >
          {enabledCount > 0
            ? `${enabledCount} method(s) enabled.`
            : "At least one payment method must be enabled."}
        </div>
      </SettingsSection>

      {/* Payouts section — on-demand only per backend (POST /v1/payouts).
          PK rule: payout methods = collection methods MINUS card. */}
      <SettingsSection
        title="Payouts"
        hint="Payouts are on-demand (merchant calls POST /v1/payouts). No frequency. Default fee: 1.0% merchant_covers."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-300 font-medium">Payout fee (%)</label>
            <div className="flex items-stretch mt-1">
              <input
                type="number"
                min={0}
                step={0.1}
                value={settings.payout_fee_pct}
                onChange={(e) => upd({ payout_fee_pct: Number(e.target.value) || 0 })}
                disabled={lock}
                className="flex-1 px-3 py-2 border border-slate-600 rounded-l-md text-sm bg-slate-900 disabled:bg-slate-800"
              />
              <span className="px-3 inline-flex items-center bg-slate-800 border border-l-0 border-slate-600 rounded-r-md text-sm text-slate-400">
                %
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">Per successful payout (snapshot at create time)</div>
          </div>
          <div>
            <label className="text-sm text-slate-300 font-medium">Who pays the payout fee</label>
            <div className="mt-1 inline-flex bg-slate-800 rounded-md p-0.5 w-full">
              <button
                onClick={() => upd({ payout_fee_model: "merchant_covers" })}
                disabled={lock}
                className={`flex-1 px-3 py-1.5 rounded text-sm ${
                  settings.payout_fee_model === "merchant_covers"
                    ? "bg-slate-900 shadow text-slate-100"
                    : "text-slate-400"
                } disabled:opacity-50`}
              >
                Merchant covers
              </button>
              <button
                onClick={() => upd({ payout_fee_model: "recipient_covers" })}
                disabled={lock}
                className={`flex-1 px-3 py-1.5 rounded text-sm ${
                  settings.payout_fee_model === "recipient_covers"
                    ? "bg-slate-900 shadow text-slate-100"
                    : "text-slate-400"
                } disabled:opacity-50`}
              >
                Recipient covers
              </button>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {settings.payout_fee_model === "merchant_covers"
                ? "Fee deducted from merchant balance — recipient receives the full amount"
                : "Fee deducted from the payout amount — recipient receives net of fee"}
            </div>
          </div>
        </div>

        {/* Payout options — methods derived from collections minus cards */}
        <div className="mt-4 pt-4 border-t border-slate-800">
          <label className="text-sm text-slate-300 font-medium">Payout method options</label>
          <div className="text-xs text-slate-400 mb-2">
            Payouts mirror your enabled collection methods <em>minus cards</em> (cards can't receive payouts).
            Toggle a method off here to disallow it for payouts only.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <PayoutOption label="M-Pesa" eligible={payoutEligible.mpesa} reason={!settings.enabled_methods.mpesa ? "Enable in collections first" : null} />
            <PayoutOption label="Airtel Money" eligible={payoutEligible.airtel} reason={!settings.enabled_methods.airtel ? "Enable in collections first" : null} />
            <PayoutOption label="Till" eligible={payoutEligible.till} reason={!settings.enabled_methods.till ? "Enable in collections first" : null} />
            <PayoutOption label="Bank transfer" eligible={payoutEligible.bank} reason={!settings.enabled_methods.bank ? "Enable in collections first" : null} />
          </div>
          {payoutEligibleCount === 0 && (
            <div className="text-xs text-rose-400 mt-2">
              No payout methods enabled — enable at least one collection method (other than card) to allow payouts.
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-300 font-medium">Max single payout (KES)</label>
            <div className="flex items-stretch mt-1">
              <span className="px-3 inline-flex items-center bg-slate-800 border border-r-0 border-slate-600 rounded-l-md text-sm text-slate-400">
                KES
              </span>
              <input
                type="number"
                min={0}
                step={1000}
                value={settings.payout_max_single_kes}
                onChange={(e) => upd({ payout_max_single_kes: Number(e.target.value) || 0 })}
                disabled={lock}
                className="flex-1 px-3 py-2 border border-slate-600 rounded-r-md text-sm bg-slate-900 disabled:bg-slate-800"
              />
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Operational ceiling per single payout transaction. Larger transfers require ops approval.
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* Settlement section — backend stores frequency on sub_merchants.settlement_preference
          and bank account on sub_merchants.settlement_destination jsonb { bank_name, account_number }.
          PK: settlement needs frequency + account number + bank name. */}
      <SettingsSection
        title="Settlement"
        hint="When and where Ogun deposits the merchant's funds. Sub-merchants inherit unless overridden."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-slate-300 font-medium">Settlement frequency</label>
            <select
              value={settings.settlement_frequency}
              onChange={(e) => upd({ settlement_frequency: e.target.value })}
              disabled={lock}
              className="mt-1 w-full px-3 py-2 border border-slate-600 rounded-md text-sm bg-slate-900 disabled:bg-slate-800 disabled:text-slate-600"
            >
              <option value="daily">Daily (6 AM EAT cron)</option>
              <option value="weekly">Weekly (Mondays)</option>
              <option value="monthly">Monthly (1st)</option>
              <option value="on_demand">On-demand (manual POST)</option>
            </select>
            <div className="text-xs text-slate-500 mt-1">
              Backend: sub_merchants.settlement_preference.
            </div>
          </div>
          <Field
            label="Bank name"
            value={settings.settlement_bank_name}
            onChange={(v) => upd({ settlement_bank_name: v })}
            disabled={lock}
            placeholder="e.g. Equity Bank Kenya"
          />
          <Field
            label="Settlement account number"
            value={settings.settlement_account_number}
            onChange={(v) => upd({ settlement_account_number: v })}
            disabled={lock}
            placeholder="0123456789"
          />
        </div>

        <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-300 font-medium">Settlement fee (KES per settlement)</label>
            <div className="flex items-stretch mt-1">
              <span className="px-3 inline-flex items-center bg-slate-800 border border-r-0 border-slate-600 rounded-l-md text-sm text-slate-400">
                KES
              </span>
              <input
                type="number"
                min={100}
                step={10}
                value={settings.settlement_fee_kes}
                onChange={(e) => upd({ settlement_fee_kes: Number(e.target.value) || 0 })}
                disabled={lock}
                className={`flex-1 px-3 py-2 border rounded-r-md text-sm ${
                  lock ? "bg-slate-950 text-slate-400" : "bg-slate-900"
                } ${feeOk ? "border-slate-600" : "border-rose-500/60"}`}
              />
            </div>
            <div className={`text-xs mt-1 ${feeOk ? "text-slate-400" : "text-rose-400"}`}>
              {feeOk
                ? "Margin-positive. We're charged ~80 KES per settlement, so this leaves ≥ 20 KES margin."
                : "Minimum 100 KES. We're charged ~80 KES per settlement — anything below 100 is loss-making."}
            </div>
          </div>
          <Field
            label="Settlement currency"
            value={settings.settlement_currency}
            onChange={(v) => upd({ settlement_currency: v })}
            disabled={lock}
          />
        </div>
      </SettingsSection>

      {/* Notifications section */}
      <SettingsSection
        title="Notifications"
        hint="Where Ogun sends webhooks failures, settlement reports, and chargeback alerts. Inherits from Step 2 Profile contact email if blank."
      >
        <Field
          label="Notification emails (comma-separated)"
          value={settings.notification_emails}
          onChange={(v) => upd({ notification_emails: v })}
          disabled={lock}
          placeholder="ops@example.com, finance@example.com"
        />
      </SettingsSection>

      {/* Ops section */}
      <SettingsSection
        title="Operations"
        hint="How disputes are handled."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-300 font-medium">Chargeback handling</label>
            <select
              value={settings.chargeback_handling}
              onChange={(e) => upd({ chargeback_handling: e.target.value })}
              disabled={lock}
              className="mt-1 w-full px-3 py-2 border border-slate-600 rounded-md text-sm bg-slate-900 disabled:bg-slate-800 disabled:text-slate-600"
            >
              <option value="auto">Auto-debit on dispute</option>
              <option value="manual">Manual review per dispute</option>
            </select>
          </div>
        </div>
      </SettingsSection>

      {/* Sub-merchants — optional, duplicates parent settings + docs on create.
          Backend supports this directly: merchant_settings and documents both
          have nullable sub_merchant_id FKs (migrations/0001 lines 59, 78).   */}
      <SettingsSection
        title="Sub-merchants"
        hint="Optional. For multi-location or multi-outlet merchants. Each sub gets its own wallet + settlement track but inherits methods, fees, and bank details from this main account unless you override them."
      >
        <SubMerchantsPanel
          subMerchants={subMerchants}
          setSubMerchants={setSubMerchants}
          merchant={merchant}
          settings={settings}
          documents={documents}
          openDrawer={openSubDrawer}
          disabled={lock}
        />
      </SettingsSection>
    </StepShell>
  );
}

// ----- Sub-merchants — inline panel inside Settings -----------------------
// PK feedback v1.2.2: "sub merchant should be an optional cta in the settings
// section, this way we can duplicate the settings docs and all information of
// the main account." This panel is the CTA + list. Creating a sub duplicates
// parent methods + fees + settlement destination into the new sub, and copies
// over the shared compliance docs (the backend stores documents with a nullable
// sub_merchant_id — null = shared/parent-level; set = sub-level).
function SubMerchantsPanel({ subMerchants, setSubMerchants, merchant, settings, documents, openDrawer, disabled }) {
  const nextSubId = `sub_${String(subMerchants.length + 1).padStart(3, "0")}`;

  const addFromParent = () => {
    // Duplicate parent account info into the new sub-merchant. The form later
    // lets the admin change name / code / settlement destination per outlet.
    const duplicated = {
      id: nextSubId,
      display_name: `${merchant.trading_name || merchant.legal_name || "New sub-merchant"} — Outlet ${subMerchants.length + 1}`,
      code: `${(merchant.trading_name || "SUB").slice(0, 3).toUpperCase()}-${String(subMerchants.length + 1).padStart(3, "0")}`,
      status: "sub-draft",
      mcc: merchant.mcc || "",
      website_url: merchant.website_url || "",
      // inherited settings (user can override per-sub later)
      inherits_settings: true,
      inherited_methods: Object.entries(settings.enabled_methods || {})
        .filter(([, on]) => on)
        .map(([k]) => k),
      settlement_preference: settings.settlement_frequency || "weekly",
      settlement_destination: {
        bank_name: settings.settlement_bank_name || "",
        account_number: settings.settlement_account_number || "",
      },
      // shared docs (ids reference parent docs — backend column sub_merchant_id
      // can remain null to mean "inherited from parent")
      inherited_documents: Object.keys(documents || {}).filter((k) =>
        ["certificate_of_incorporation", "kra_pin", "cr12", "business_address_proof"].includes(k),
      ),
    };
    setSubMerchants([...subMerchants, duplicated]);
  };

  return (
    <div>
      <button
        onClick={addFromParent}
        disabled={disabled}
        data-testid="add-sub-from-parent"
        className="px-3 py-2 rounded-md text-sm text-white bg-indigo-500 hover:bg-indigo-400 disabled:bg-slate-700 disabled:cursor-not-allowed"
      >
        + Add sub-merchant (duplicates this account's settings and documents)
      </button>
      <div className="text-[11px] text-slate-400 mt-1">
        Creates a new sub with the main account's methods, fees, settlement bank, and compliance docs pre-copied. Override any field per sub from the edit drawer.
      </div>

      {subMerchants.length === 0 ? (
        <div className="mt-3 text-xs text-slate-500 italic">No sub-merchants yet.</div>
      ) : (
        <div className="mt-3 space-y-2">
          {subMerchants.map((sub) => (
            <div key={sub.id} className="flex items-center justify-between border border-slate-700 rounded-md p-3 bg-slate-950">
              <div>
                <div className="text-sm font-medium text-slate-200">{sub.display_name}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {sub.id} · {sub.code || "no code"} · status {sub.status}
                  {sub.inherits_settings && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide bg-emerald-900/30 text-emerald-300 border border-emerald-700/50 rounded px-1.5 py-0.5">
                      inherits parent settings
                    </span>
                  )}
                </div>
                {sub.inherited_methods && sub.inherited_methods.length > 0 && (
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Methods: {sub.inherited_methods.join(", ")} · Settlement: {sub.settlement_preference} to {sub.settlement_destination?.bank_name || "—"}
                  </div>
                )}
              </div>
              <button
                onClick={() => openDrawer(sub.id)}
                className="text-xs px-2.5 py-1.5 rounded border border-slate-600 hover:bg-slate-900"
              >
                Edit / override
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsSection({ title, hint, children }) {
  return (
    <div className="border border-slate-700 rounded-lg p-4 mt-3 bg-slate-900">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-semibold text-slate-200">{title}</h3>
      </div>
      {hint && <div className="text-xs text-slate-400 mb-3">{hint}</div>}
      {children}
    </div>
  );
}

function PayoutOption({ label, eligible, reason }) {
  return (
    <div
      className={`text-left border-2 rounded-lg p-3 ${
        eligible
          ? "border-emerald-600/60 bg-emerald-900/30"
          : "border-slate-700 bg-slate-950"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-4 h-4 rounded border-2 grid place-items-center ${
            eligible ? "border-emerald-500 bg-emerald-500" : "border-slate-600 bg-slate-900"
          }`}
        >
          {eligible && (
            <span className="text-white text-[10px] leading-none font-bold">✓</span>
          )}
        </span>
        <div className={`font-medium text-sm ${eligible ? "text-slate-100" : "text-slate-400"}`}>{label}</div>
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-1 ml-6">
        {eligible ? "Available for payouts" : reason || "Not enabled"}
      </div>
    </div>
  );
}

function MethodToggle({ label, on, onChange, disabled, badge }) {
  return (
    <button
      onClick={() => onChange(!on)}
      disabled={disabled}
      className={`text-left border-2 rounded-lg p-3 transition ${
        on
          ? "border-indigo-400 bg-indigo-900/30"
          : "border-slate-700 bg-slate-900 hover:border-indigo-600/60"
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-4 h-4 rounded border-2 grid place-items-center ${
            on ? "border-indigo-500 bg-indigo-500" : "border-slate-600 bg-slate-900"
          }`}
        >
          {on && (
            <span className="text-white text-[10px] leading-none font-bold">✓</span>
          )}
        </span>
        <div className="font-medium text-sm">{label}</div>
      </div>
      {badge && (
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-1 ml-6">{badge}</div>
      )}
    </button>
  );
}

// ----- Step 5 — AI Compliance ---------------------------------------------

function Step5Compliance({ pipeline, setPipeline, documents, view, merchant, setMerchant, onBack, onNext, nextLabel }) {
  const adminOnly = view !== "admin";
  const docsCount = Object.values(documents).filter((d) => d?.status === "uploaded").length;

  const run = () => {
    setPipeline({ ran: false, ocr: "running", rules: null, judgment: null });
    setTimeout(() => {
      setPipeline((p) => ({ ...p, ocr: "complete", rules: "running" }));
      setTimeout(() => {
        setPipeline((p) => ({ ...p, rules: "complete", judgment: "running" }));
        setTimeout(() => {
          setPipeline({ ran: true, ocr: "complete", rules: "complete", judgment: "complete" });
          if (merchant.status === "kyb_in_progress") {
            setMerchant({ ...merchant, status: "kyb_approved" });
          }
        }, 800);
      }, 800);
    }, 800);
  };

  const nextHint = pipeline.ran
    ? "Pipeline complete — recommendation ready for Review"
    : "Run the pipeline before moving to Review";

  return (
    <StepShell
      title="AI Compliance"
      subtitle="3-layer pipeline: Document AI → Rules → Reasoning"
      view={view}
      onBack={onBack}
      onNext={onNext}
      nextLabel={nextLabel}
      nextDisabled={!pipeline.ran}
      nextHint={nextHint}
    >
      {adminOnly && (
        <Banner kind="info">
          Merchants don't see this step. Run is admin-only and produces the recommendation that feeds Step 5 Review.
        </Banner>
      )}
      <div className="grid grid-cols-3 gap-3 mt-2">
        <PipelineCard label="Document AI extraction" status={pipeline.ocr} hint={`${docsCount} doc(s) ingested`} />
        <PipelineCard label="Deterministic rules" status={pipeline.rules} hint="ID match · sanctions · address proof" />
        <PipelineCard label="Claude reasoning" status={pipeline.judgment} hint="Risk score + recommendation" />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={run}
          disabled={view !== "admin" || docsCount === 0}
          className="px-3 py-2 rounded-md bg-indigo-500 text-white text-sm disabled:bg-slate-700"
        >
          Run pipeline
        </button>
        {pipeline.ran && (
          <div className="text-sm text-emerald-300">
            ✓ Pipeline complete. Recommendation: <span className="font-medium">Approve with conditions</span>. See Step 5 Review.
          </div>
        )}
        {!pipeline.ran && docsCount === 0 && (
          <div className="text-sm text-amber-300">Upload at least one document on Step 1 People & Documents to run the pipeline.</div>
        )}
      </div>
    </StepShell>
  );
}

function PipelineCard({ label, status, hint }) {
  const tint =
    status === "complete"
      ? "border-emerald-700/50 bg-emerald-900/30"
      : status === "running"
      ? "border-blue-200 bg-blue-50 animate-pulse"
      : "border-slate-700 bg-slate-900";
  const dot =
    status === "complete" ? "bg-emerald-500" : status === "running" ? "bg-blue-500" : "bg-slate-700";
  const txt = status === "complete" ? "Complete" : status === "running" ? "Running…" : "Idle";
  return (
    <div className={`rounded-lg border p-3 ${tint}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`}></span>
        <div className="font-medium text-sm">{label}</div>
      </div>
      <div className="text-xs text-slate-400 mt-1">{hint}</div>
      <div className="text-xs text-slate-300 mt-1 font-medium">{txt}</div>
    </div>
  );
}

// ----- Step 6 — Review -----------------------------------------------------

function Step6Review({ merchant, setMerchant, review, setReview, documents, directors, pipeline, view, editable, onBack, onNext, nextLabel }) {
  // PK feedback: admin needs to be able to click Approve / Request changes / Reject
  // and have it actually trigger next-step transitions. The previous `!editable` gate
  // required merchant.status === 'kyb_approved' before the tiles became clickable —
  // forcing admins to navigate via the demo panel first. Drop that gate; tiles are
  // now clickable in admin view at any point in the flow (this is admin-only by design).
  const isAdmin = view === "admin";
  const decisionLocked = !isAdmin; // merchants never decide here
  const docsCount = Object.values(documents).filter((d) => d?.status === "uploaded").length;
  const ownership = directors.reduce((s, d) => s + (Number(d.ownership_pct) || 0), 0);

  const decide = () => {
    if (!review.decision) return;
    if (review.decision === "approve") {
      // Approval issues credentials and unlocks Settings + Activate downstream.
      setMerchant({ ...merchant, status: "credentials_issued" });
    } else if (review.decision === "reject") {
      setMerchant({ ...merchant, status: "rejected" });
    } else if (review.decision === "changes") {
      // Move to changes_requested per backend state-machines §1
      setMerchant({ ...merchant, status: "kyb_in_progress" });
    }
  };

  // Next enabled once admin has approved (credentials_issued is gate for Activate)
  const readyForActivate = ["credentials_issued", "ready_for_activation", "active"].includes(
    merchant.status,
  );
  const nextHint = readyForActivate
    ? "Approved — credentials issued"
    : "Approve to issue credentials and continue to Activate";

  return (
    <StepShell
      title="Review"
      subtitle="Admin sign-off — approve, request changes, or reject"
      view={view}
      onBack={onBack}
      onNext={onNext}
      nextLabel={nextLabel}
      nextDisabled={!readyForActivate}
      nextHint={nextHint}
    >
      {decisionLocked && (
        <Banner kind="info">Merchants don't decide here. They see status updates on their dashboard once admin acts.</Banner>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
        <SummaryCard label="Profile">
          <div className="text-sm">
            <div className="font-medium">{merchant.legal_name || "—"}</div>
            <div className="text-slate-400">{merchant.trading_name || "—"}</div>
            <div className="text-xs text-slate-500 mt-1">{merchant.business_address || "—"}</div>
          </div>
        </SummaryCard>
        <SummaryCard label="Directors & UBOs">
          {(() => {
            const dirCount = directors.filter((d) => d.is_director).length;
            const uboCount = directors.filter(
              (d) => d.is_ubo || (Number(d.ownership_pct) || 0) >= 25
            ).length;
            return (
              <div className="text-sm">
                <div className="font-medium">
                  {dirCount} director(s) · {uboCount} UBO(s)
                </div>
                <div className="text-slate-400">Ownership total: {ownership}%</div>
                <div className="text-xs text-slate-500 mt-1">
                  {ownership === 100 ? "✓ matches 100%" : "✗ does not equal 100%"}
                </div>
              </div>
            );
          })()}
        </SummaryCard>
        <SummaryCard label="Documents">
          <div className="text-sm">
            <div className="font-medium">{docsCount} uploaded</div>
            <div className="text-slate-400">AI pipeline: {pipeline.ran ? "complete" : "not run"}</div>
          </div>
        </SummaryCard>
      </div>

      <div className="mt-5 border-t border-slate-700 pt-5">
        <div className="text-sm font-medium text-slate-200 mb-3">Decision</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <DecisionTile
            kind="approve"
            label="Approve"
            description="Issue credentials and move to Settings"
            checked={review.decision === "approve"}
            onClick={() => setReview({ ...review, decision: "approve" })}
            disabled={decisionLocked}
          />
          <DecisionTile
            kind="changes"
            label="Request changes"
            description="Send back to merchant with notes"
            checked={review.decision === "changes"}
            onClick={() => setReview({ ...review, decision: "changes" })}
            disabled={decisionLocked}
          />
          <DecisionTile
            kind="reject"
            label="Reject"
            description="Final — merchant cannot resubmit"
            checked={review.decision === "reject"}
            onClick={() => setReview({ ...review, decision: "reject" })}
            disabled={decisionLocked}
          />
        </div>

        {review.decision && (
          <div className="mt-4">
            <label className="text-sm text-slate-300 font-medium">
              Note {review.decision === "changes" ? "(required)" : "(optional)"}
            </label>
            <textarea
              value={review.note}
              onChange={(e) => setReview({ ...review, note: e.target.value })}
              disabled={decisionLocked}
              rows={3}
              placeholder={
                review.decision === "approve"
                  ? "e.g. Approved with annual review on file"
                  : review.decision === "reject"
                  ? "Reason for rejection (sent to merchant)"
                  : "What needs to change (sent to merchant)"
              }
              className="mt-1 w-full px-3 py-2 border border-slate-600 rounded-md text-sm bg-slate-900 disabled:bg-slate-800"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={decide}
                disabled={decisionLocked || (review.decision === "changes" && !review.note.trim())}
                className={`px-3 py-2 rounded-md text-sm text-white ${
                  review.decision === "approve"
                    ? "bg-emerald-500 hover:bg-emerald-400"
                    : review.decision === "reject"
                    ? "bg-rose-500 hover:bg-rose-400"
                    : "bg-amber-500 hover:bg-amber-400"
                } disabled:bg-slate-700`}
              >
                Confirm {review.decision === "approve" ? "Approval" : review.decision === "reject" ? "Rejection" : "Changes Request"}
              </button>
              <span className="text-xs text-slate-400">
                {review.decision === "approve"
                  ? "Status will move to credentials_issued"
                  : review.decision === "reject"
                  ? "Status will move to rejected (final)"
                  : "Status will move to kyb_in_progress — note is sent to merchant"}
              </span>
            </div>
          </div>
        )}
      </div>
    </StepShell>
  );
}

function DecisionTile({ kind, label, description, checked, onClick, disabled }) {
  const tints = {
    approve: checked
      ? "border-emerald-400 bg-emerald-900/30"
      : "border-slate-700 hover:border-emerald-600/60 hover:bg-emerald-900/40/40",
    changes: checked
      ? "border-amber-400 bg-amber-900/30"
      : "border-slate-700 hover:border-amber-600/60 hover:bg-amber-900/40/40",
    reject: checked
      ? "border-rose-400 bg-rose-900/30"
      : "border-slate-700 hover:border-rose-600/60 hover:bg-rose-900/40/40",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left border-2 rounded-lg p-3 transition ${tints[kind]} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-4 h-4 rounded-full border-2 ${
            checked
              ? kind === "approve"
                ? "border-emerald-500 bg-emerald-500"
                : kind === "reject"
                ? "border-rose-500 bg-rose-500"
                : "border-amber-500 bg-amber-500"
              : "border-slate-600 bg-slate-900"
          }`}
        ></span>
        <div className="font-medium text-sm">{label}</div>
      </div>
      <div className="text-xs text-slate-400 mt-1 ml-6">{description}</div>
    </button>
  );
}

function SummaryCard({ label, children }) {
  return (
    <div className="border border-slate-700 rounded-lg bg-slate-900 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-2">{label}</div>
      {children}
    </div>
  );
}

// ----- Step 6 — Activate (final step in v1.2.2) ---------------------------

function Step7Activate({
  merchant,
  setMerchant,
  credentials,
  attested,
  setAttested,
  revealActive,
  revealRemaining,
  startReveal,
  rotateSecret,
  view,
  onBack,
  onActivate,
}) {
  const ready =
    ["credentials_issued", "settings_configured", "ready_for_activation"].includes(merchant.status) &&
    attested;
  const activated = merchant.status === "active";

  const activate = () => {
    if (!ready) return;
    setMerchant({ ...merchant, status: "active" });
    if (typeof onActivate === "function") onActivate();
  };

  return (
    <StepShell
      title="Activate"
      subtitle="Final attestation, then go live"
      view={view}
      onBack={onBack}
    >
      {activated ? (
        <Banner kind="ok">
          <div className="font-medium">Merchant is live</div>
          <div className="text-xs text-slate-400 mt-1">
            Production traffic enabled. Sub-merchants activate independently on their own mini-flow.
          </div>
        </Banner>
      ) : (
        <Banner kind="info">
          <div className="font-medium">Pre-activation checklist</div>
          <div className="text-xs text-slate-400 mt-1">
            Settings configured, credentials issued, attestation accepted → admin clicks Activate to go live.
          </div>
        </Banner>
      )}

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border border-slate-700 rounded-lg p-3 bg-slate-900">
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-2">Credentials</div>
          <div className="text-xs text-slate-400">Publishable key</div>
          <div className="font-mono text-sm bg-slate-950 border border-slate-700 rounded px-2 py-1 mt-1 break-all">
            {credentials.publishable || "— issued after approval —"}
          </div>
          <div className="text-xs text-slate-400 mt-3 flex items-center gap-2">
            Secret key
            {revealActive && (
              <span className="text-[10px] uppercase tracking-wide bg-amber-900/30 text-amber-300 border border-amber-700/50 rounded px-1.5">
                Visible · {fmtTime(revealRemaining)}
              </span>
            )}
          </div>
          <div className="font-mono text-sm bg-slate-950 border border-slate-700 rounded px-2 py-1 mt-1 break-all">
            {credentials.secret ? (revealActive ? credentials.secret : maskKey(credentials.secret)) : "— issued after approval —"}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={startReveal}
              disabled={!credentials.secret || revealActive}
              className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-800 disabled:opacity-50"
            >
              Reveal for 30s
            </button>
            <button
              onClick={rotateSecret}
              disabled={!credentials.secret}
              className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-800 disabled:opacity-50"
            >
              Rotate
            </button>
          </div>
        </div>

        <div className="border border-slate-700 rounded-lg p-3 bg-slate-900">
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-2">Attestation</div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              className="mt-1"
              disabled={activated}
            />
            <span>
              I confirm that all submitted information is accurate, the business is operating under the listed
              entity, and I accept Ogun's Master Services Agreement and Acceptable Use Policy.
            </span>
          </label>
          <div className="text-xs text-slate-400 mt-2">
            Required before activation. Credentials persist after this — they don't disappear.
          </div>
        </div>
      </div>

      {!activated && (
        <div className="mt-5 border-t border-slate-700 pt-5">
          <div className="flex items-center gap-3">
            <button
              onClick={activate}
              disabled={!ready || view !== "admin"}
              className="px-4 py-2.5 rounded-md text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-400 disabled:bg-slate-700 disabled:cursor-not-allowed"
            >
              Activate merchant
            </button>
            {!attested && view === "admin" && (
              <span className="text-xs text-slate-400">Awaiting attestation above</span>
            )}
            {view !== "admin" && <span className="text-xs text-slate-400">Activation is admin-only</span>}
            {attested && view === "admin" && !["credentials_issued", "settings_configured", "ready_for_activation"].includes(merchant.status) && (
              <span className="text-xs text-amber-300">
                Status must be credentials_issued or later — currently {merchant.status}
              </span>
            )}
          </div>
        </div>
      )}
    </StepShell>
  );
}

// ----- Sub-merchant status enum (backend reference) -----------------------
// Sub-merchant statuses per sub_merchants.status (migrations/0001:39). The
// dedicated step for sub-merchants was removed in v1.2.2; management now lives
// inside the Settings step via SubMerchantsPanel + SubMerchantDrawer.
const SUB_STATUSES = ["sub-draft", "sub-submitted", "sub-under-review", "sub-approved", "sub-active"];

function SubMerchantDrawer({ sub, subMerchants, setSubMerchants, close, merchantStatus }) {
  if (!sub) return null;
  const update = (patch) =>
    setSubMerchants(subMerchants.map((s) => (s.id === sub.id ? { ...s, ...patch } : s)));
  const advance = () => {
    const idx = SUB_STATUSES.indexOf(sub.status);
    if (idx < 0 || idx >= SUB_STATUSES.length - 1) return;
    update({ status: SUB_STATUSES[idx + 1] });
  };
  return (
    <div className="fixed inset-0 z-20 bg-slate-900/40" onClick={close}>
      <div
        className="absolute right-0 top-0 h-full w-full max-w-md bg-slate-900 shadow-xl border-l border-slate-700 p-5 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <div className="text-lg font-semibold">{sub.display_name}</div>
          <button onClick={close} className="ml-auto text-slate-500 hover:text-slate-200 text-sm">
            Close
          </button>
        </div>
        <div className="text-xs text-slate-400 font-mono mt-1">
          {sub.id} · parent: {merchantStatus}
        </div>
        <div className="mt-4 space-y-3">
          <Field label="Display name" value={sub.display_name} onChange={(v) => update({ display_name: v })} />
          <Field label="MCC" value={sub.mcc} onChange={(v) => update({ mcc: v })} />
          <Field label="Website" value={sub.website_url} onChange={(v) => update({ website_url: v })} />
          <div>
            <label className="text-sm text-slate-300 font-medium">Status</label>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              {SUB_STATUSES.map((s) => (
                <span
                  key={s}
                  className={`text-[10px] uppercase rounded border px-1.5 py-0.5 ${
                    s === sub.status
                      ? "bg-indigo-900/30 text-indigo-300 border-indigo-700/50"
                      : "bg-slate-950 text-slate-400 border-slate-700"
                  }`}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={advance}
            disabled={sub.status === "sub-active"}
            className="px-3 py-2 rounded-md bg-indigo-500 text-white text-sm disabled:bg-slate-700"
          >
            Advance status →
          </button>
          <div className="text-xs text-slate-400">
            Sub-merchants activate <span className="font-medium">independently</span> of the parent. The parent doesn't
            cascade activation onto its subs.
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- shared widgets ------------------------------------------------------

// PK feedback v1.2.1: every step needs a Next CTA so the user can move forward
// when done. StepShell now renders a sticky footer with Back / Next when those
// handlers are provided. The label of the Next button can be customised per step
// (e.g. "Continue to Profile", "Run pipeline", "Activate merchant").
function StepShell({ title, subtitle, view, children, onBack, onNext, nextLabel, nextDisabled, nextHint }) {
  const hasNav = onBack || onNext;
  return (
    <section className="bg-slate-900 border border-slate-700 rounded-lg p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <div className="text-sm text-slate-400 mt-0.5">{subtitle}</div>}
        </div>
        <span className="text-[10px] uppercase tracking-wide bg-slate-800 text-slate-400 border border-slate-700 rounded px-1.5 py-0.5">
          {view} view
        </span>
      </div>
      <div className="mt-4">{children}</div>
      {hasNav && (
        <div className="mt-6 pt-4 border-t border-slate-700 flex items-center justify-between gap-3">
          <div>
            {onBack && (
              <button
                onClick={onBack}
                className="px-4 py-2 rounded-md text-sm border border-slate-600 text-slate-300 hover:bg-slate-800"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {nextHint && <span className="text-xs text-slate-400">{nextHint}</span>}
            {onNext && (
              <button
                onClick={onNext}
                disabled={nextDisabled}
                className="px-4 py-2 rounded-md text-sm text-white bg-indigo-500 hover:bg-indigo-400 disabled:bg-slate-700 disabled:cursor-not-allowed"
              >
                {nextLabel || "Next →"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, onChange, disabled, type = "text", placeholder, help }) {
  return (
    <div>
      <label className="text-sm text-slate-300 font-medium">{label}</label>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className={`mt-1 w-full px-3 py-2 border rounded-md text-sm ${
          disabled ? "bg-slate-950 text-slate-400 border-slate-700" : "border-slate-600 bg-slate-900"
        }`}
      />
      {help && <div className="text-xs text-slate-500 mt-1">{help}</div>}
    </div>
  );
}

function Banner({ kind, children }) {
  const tints = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warn: "border-amber-700/50 bg-amber-900/30 text-amber-100",
    ok: "border-emerald-700/50 bg-emerald-900/30 text-emerald-100",
  };
  return <div className={`border rounded-md px-3 py-2 text-sm ${tints[kind] || tints.info}`}>{children}</div>;
}

// ============================================================================
// v1.3.0 — Post-activation Merchant Panel + Compliance List landing
// ============================================================================
// This block ships the post-activation experience PK asked for:
//   list  → click '+ Create merchant'  → wizard (existing build)
//   list  → click existing merchant row → MerchantPanel
//   panel → top tabs: Settings | Collections | Payouts | Settlements
//   panel → Settings sub-tabs: Profile | Accounts | Sub-merchants | Credentials
// Dashboards follow the "2+1" pattern confirmed in AskUserQuestion:
//   4 KPI cards + a 7-day sparkline + a recent-activity table (empty-state fallback).
// ============================================================================

function fmtKES(cents, currency = "KES") {
  if (cents == null) return "—";
  const major = cents / 100;
  return `${currency} ${major.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}
function fmtDateShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-KE", { month: "short", day: "numeric" });
}
function fmtTimeShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
}

// Tiny inline sparkline — 7 bars, rendered as flex divs (no SVG needed).
function Sparkline({ values, accent = "bg-sky-500" }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1 h-12">
      {values.map((v, i) => {
        const h = Math.max(4, Math.round((v / max) * 100));
        return (
          <div
            key={i}
            className={`${accent} rounded-sm flex-1 opacity-80`}
            style={{ height: `${h}%` }}
            title={String(v)}
          />
        );
      })}
    </div>
  );
}

// Simple KPI card reused across the three dashboards.
function KpiCard({ label, value, sublabel, tone }) {
  const tones = {
    ok: "text-emerald-300",
    warn: "text-amber-300",
    danger: "text-rose-300",
    info: "text-slate-100",
  };
  return (
    <div className="border border-slate-700 rounded-lg p-4 bg-slate-900">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${tones[tone || "info"]}`}>{value}</div>
      {sublabel && <div className="text-xs text-slate-400 mt-1">{sublabel}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ComplianceListView — matches the live screenshot PK shared on 2026-04-24.
// ---------------------------------------------------------------------------
function ComplianceListView({ merchants, onCreate, onRowClick }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");

  const filtered = merchants.filter((m) => {
    if (statusFilter !== "all" && m.status !== statusFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      if (
        !m.legal_name.toLowerCase().includes(q) &&
        !(m.trading_name || "").toLowerCase().includes(q) &&
        !m.id.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Compliance Review</h1>
          <p className="text-sm text-slate-400 mt-1">
            {filtered.length} merchant{filtered.length === 1 ? "" : "s"} in view. Click a row to
            open the merchant panel.
          </p>
        </div>
        <button
          onClick={onCreate}
          className="px-4 py-2.5 rounded-md text-sm font-medium bg-slate-100 text-slate-900 hover:bg-white"
        >
          + Create merchant
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="kyb_in_progress">Under review</option>
          <option value="kyb_approved">Approved</option>
          <option value="credentials_issued">Credentials issued</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by merchant ID or name…"
          className="bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-sm flex-1 max-w-md"
        />
      </div>

      <div className="border border-slate-700 rounded-lg overflow-x-auto bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-950 border-b border-slate-700">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-medium">Merchant ID</th>
              <th className="px-4 py-3 font-medium">Legal name</th>
              <th className="px-4 py-3 font-medium">Country</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No merchants match this filter.
                </td>
              </tr>
            )}
            {filtered.map((m) => (
              <tr
                key={m.id}
                onClick={() => onRowClick(m)}
                className="border-b border-slate-800 last:border-0 hover:bg-slate-800 cursor-pointer"
              >
                <td className="px-4 py-3 font-mono text-xs text-slate-300">{m.id}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-100">{m.legal_name}</div>
                  {m.trading_name && m.trading_name !== m.legal_name && (
                    <div className="text-xs text-slate-400">Trading as {m.trading_name}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-300">{m.country || "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[11px] uppercase tracking-wide font-medium px-2 py-0.5 rounded ${
                      m.status === "active"
                        ? "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50"
                        : m.status === "suspended" || m.status === "rejected"
                        ? "bg-rose-900/30 text-rose-300 border border-rose-700/50"
                        : "bg-slate-800 text-slate-300 border border-slate-700"
                    }`}
                  >
                    {STATUS_LABEL[m.status] || m.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{fmtDateShort(m.created_at)}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{fmtDateShort(m.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MerchantPanel — routes between Settings (4 sub-tabs) + three dashboards.
// ---------------------------------------------------------------------------
function MerchantPanel({
  merchant,
  updateMerchant,
  panelTab,
  setPanelTab,
  settingsSubTab,
  setSettingsSubTab,
  revealUntil,
  startReveal,
  revealRemaining,
  onBack,
}) {
  const tabs = [
    { id: "settings", label: "Settings" },
    { id: "collections", label: "Collections" },
    { id: "payouts", label: "Payouts" },
    { id: "settlements", label: "Settlements" },
  ];

  return (
    <div className="max-w-6xl mx-auto p-6">
      <button onClick={onBack} className="text-xs text-slate-400 hover:text-slate-200 mb-3">
        ← Back to merchants
      </button>

      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">{merchant.legal_name}</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            <span className="font-mono text-xs">{merchant.id}</span>
            {" · "}
            <span
              className={`text-[11px] uppercase tracking-wide font-medium px-2 py-0.5 rounded ${
                merchant.status === "active"
                  ? "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50"
                  : "bg-slate-800 text-slate-300 border border-slate-700"
              }`}
            >
              {STATUS_LABEL[merchant.status] || merchant.status}
            </span>
          </p>
        </div>
      </div>

      <div className="border-b border-slate-700 mb-5 flex items-center gap-1">
        {tabs.map((t) => {
          const active = panelTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setPanelTab(t.id)}
              className={`px-4 py-2 text-sm border-b-2 -mb-[2px] ${
                active
                  ? "border-slate-100 text-slate-100 font-medium"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {panelTab === "settings" && (
        <SettingsTab
          merchant={merchant}
          updateMerchant={updateMerchant}
          subTab={settingsSubTab}
          setSubTab={setSettingsSubTab}
          revealUntil={revealUntil}
          startReveal={startReveal}
          revealRemaining={revealRemaining}
        />
      )}
      {panelTab === "collections" && (
        <CollectionsDashboard data={merchant.activity?.collections} currency={merchant.settlement_currency} />
      )}
      {panelTab === "payouts" && (
        <PayoutsDashboard data={merchant.activity?.payouts} currency={merchant.settlement_currency} />
      )}
      {panelTab === "settlements" && (
        <SettlementsDashboard data={merchant.activity?.settlements} currency={merchant.settlement_currency} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab — four sub-tabs: Profile, Accounts, Sub-merchants, Credentials
// ---------------------------------------------------------------------------
function SettingsTab({ merchant, updateMerchant, subTab, setSubTab, revealUntil, startReveal, revealRemaining }) {
  const subs = [
    { id: "profile", label: "Profile information" },
    { id: "accounts", label: "Account settings" },
    { id: "sub_merchants", label: "Sub-merchants" },
    { id: "credentials", label: "Credentials" },
  ];
  const revealActive = revealRemaining > 0;
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {subs.map((s) => {
          const active = subTab === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSubTab(s.id)}
              className={`text-xs px-3 py-1.5 rounded-md border ${
                active
                  ? "bg-slate-100 text-slate-900 border-slate-100"
                  : "bg-slate-900 text-slate-400 border-slate-600 hover:bg-slate-800"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {subTab === "profile" && <ProfileSubTab merchant={merchant} />}
      {subTab === "accounts" && <AccountsSubTab merchant={merchant} updateMerchant={updateMerchant} />}
      {subTab === "sub_merchants" && <SubMerchantsSubTab merchant={merchant} />}
      {subTab === "credentials" && (
        <CredentialsSubTab
          merchant={merchant}
          revealActive={revealActive}
          revealRemaining={revealRemaining}
          startReveal={startReveal}
        />
      )}
    </div>
  );
}

function ProfileSubTab({ merchant }) {
  const row = (label, value) => (
    <div className="flex items-start py-2 border-b border-slate-800 last:border-0">
      <div className="w-44 text-xs uppercase tracking-wide text-slate-500 font-medium shrink-0">
        {label}
      </div>
      <div className="text-sm text-slate-200 break-all">{value || "—"}</div>
    </div>
  );
  return (
    <div className="border border-slate-700 rounded-lg p-5 bg-slate-900 max-w-3xl">
      <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-2">Business</div>
      {row("Legal name", merchant.legal_name)}
      {row("Trading name", merchant.trading_name)}
      {row("Registration no.", merchant.registration_number)}
      {row("Tax ID", merchant.tax_id)}
      {row("Business category", merchant.business_category)}
      {row("Website", merchant.website_url)}
      {row("Address", merchant.business_address)}
      {row("Country", merchant.country)}
      {row("Settlement currency", merchant.settlement_currency)}
      <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mt-5 mb-2">Contact</div>
      {row("Name", merchant.contact_name)}
      {row("Email", merchant.contact_email)}
      {row("Phone", merchant.contact_phone)}
      <div className="text-xs text-slate-400 mt-3">
        Profile fields are locked after activation. Contact Ogun ops to update.
      </div>
    </div>
  );
}

function AccountsSubTab({ merchant, updateMerchant }) {
  const s = merchant.settings || {};
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    collection_fee_pct: s.collection_fee_pct ?? 0,
    collection_fee_model: s.collection_fee_model || "merchant_covers",
    payout_fee_pct: s.payout_fee_pct ?? 0,
    payout_fee_model: s.payout_fee_model || "merchant_covers",
    settlement_fee_pct: s.settlement_fee_pct ?? 0,
    enabled_methods: s.enabled_methods || [],
  });
  const save = () => {
    updateMerchant({ settings: { ...s, ...draft } });
    setEditing(false);
  };
  const methods = ["mpesa", "airtel", "till", "card", "bank"];
  return (
    <div className="border border-slate-700 rounded-lg p-5 bg-slate-900 max-w-3xl">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wide text-slate-500 font-medium">Fees</div>
        {!editing ? (
          <button onClick={() => setEditing(true)} className="text-xs px-3 py-1 rounded border border-slate-600 hover:bg-slate-800">
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="text-xs px-3 py-1 rounded border border-slate-600 hover:bg-slate-800">
              Cancel
            </button>
            <button onClick={save} className="text-xs px-3 py-1 rounded bg-slate-100 text-slate-900">
              Save
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-slate-400 mb-1">Collection fee</div>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={draft.collection_fee_pct}
                onChange={(e) => setDraft({ ...draft, collection_fee_pct: parseFloat(e.target.value) || 0 })}
                className="border border-slate-600 rounded px-2 py-1 w-20 text-sm"
              />
              <span className="text-xs text-slate-400">%</span>
              <select
                value={draft.collection_fee_model}
                onChange={(e) => setDraft({ ...draft, collection_fee_model: e.target.value })}
                className="border border-slate-600 rounded px-2 py-1 text-xs"
              >
                <option value="merchant_covers">Merchant covers</option>
                <option value="payer_covers">Payer covers</option>
              </select>
            </div>
          ) : (
            <div className="text-slate-100">
              {s.collection_fee_pct}%{" "}
              <span className="text-xs text-slate-400">
                ({s.collection_fee_model?.replace("_", " ")})
              </span>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1">Payout fee</div>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={draft.payout_fee_pct}
                onChange={(e) => setDraft({ ...draft, payout_fee_pct: parseFloat(e.target.value) || 0 })}
                className="border border-slate-600 rounded px-2 py-1 w-20 text-sm"
              />
              <span className="text-xs text-slate-400">%</span>
              <select
                value={draft.payout_fee_model}
                onChange={(e) => setDraft({ ...draft, payout_fee_model: e.target.value })}
                className="border border-slate-600 rounded px-2 py-1 text-xs"
              >
                <option value="merchant_covers">Merchant covers</option>
                <option value="recipient_covers">Recipient covers</option>
              </select>
            </div>
          ) : (
            <div className="text-slate-100">
              {s.payout_fee_pct}%{" "}
              <span className="text-xs text-slate-400">
                ({s.payout_fee_model?.replace("_", " ")})
              </span>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1">Settlement fee</div>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.05"
                value={draft.settlement_fee_pct}
                onChange={(e) => setDraft({ ...draft, settlement_fee_pct: parseFloat(e.target.value) || 0 })}
                className="border border-slate-600 rounded px-2 py-1 w-20 text-sm"
              />
              <span className="text-xs text-slate-400">%</span>
            </div>
          ) : (
            <div className="text-slate-100">{s.settlement_fee_pct}%</div>
          )}
        </div>
      </div>

      <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mt-5 mb-2">Enabled methods</div>
      <div className="flex flex-wrap gap-2">
        {methods.map((m) => {
          const enabled = editing ? draft.enabled_methods.includes(m) : (s.enabled_methods || []).includes(m);
          if (editing) {
            return (
              <label key={m} className="flex items-center gap-1 text-xs border border-slate-600 rounded px-2 py-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...draft.enabled_methods, m]
                      : draft.enabled_methods.filter((x) => x !== m);
                    setDraft({ ...draft, enabled_methods: next });
                  }}
                />
                {m}
              </label>
            );
          }
          return (
            <span
              key={m}
              className={`text-xs px-2 py-1 rounded border ${
                enabled
                  ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/50"
                  : "bg-slate-950 text-slate-500 border-slate-700 line-through"
              }`}
            >
              {m}
            </span>
          );
        })}
      </div>

      <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mt-5 mb-2">Notifications</div>
      <div className="text-sm text-slate-200">
        {(s.notification_emails || []).length > 0 ? s.notification_emails.join(", ") : "—"}
      </div>
    </div>
  );
}

function SubMerchantsSubTab({ merchant }) {
  const subs = merchant.sub_merchants || [];
  return (
    <div className="border border-slate-700 rounded-lg bg-slate-900 overflow-x-auto max-w-5xl">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <div>
          <div className="text-sm font-medium text-slate-100">Sub-merchants</div>
          <div className="text-xs text-slate-400">
            {subs.length} sub-merchant{subs.length === 1 ? "" : "s"} configured. Each settles independently.
          </div>
        </div>
        <button className="text-xs px-3 py-1.5 rounded-md border border-slate-600 hover:bg-slate-800">
          + Add sub-merchant
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-950 border-b border-slate-700">
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
            <th className="px-4 py-2 font-medium">Sub-merchant ID</th>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Settlement</th>
            <th className="px-4 py-2 font-medium">Destination</th>
          </tr>
        </thead>
        <tbody>
          {subs.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">
                No sub-merchants yet.
              </td>
            </tr>
          )}
          {subs.map((s) => (
            <tr key={s.id} className="border-b border-slate-800 last:border-0">
              <td className="px-4 py-2 font-mono text-xs text-slate-300">{s.id}</td>
              <td className="px-4 py-2">
                <div className="font-medium text-slate-100">{s.name}</div>
                {s.code && <div className="text-xs text-slate-400">{s.code}</div>}
              </td>
              <td className="px-4 py-2">
                <span
                  className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                    s.status === "active"
                      ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/50"
                      : "bg-slate-800 text-slate-300 border-slate-700"
                  }`}
                >
                  {s.status}
                </span>
              </td>
              <td className="px-4 py-2 text-sm text-slate-300 capitalize">{s.settlement_preference}</td>
              <td className="px-4 py-2 text-xs text-slate-400">
                {s.settlement_destination?.bank_name} {s.settlement_destination?.account_number}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CredentialsSubTab({ merchant, revealActive, revealRemaining, startReveal }) {
  const c = merchant.credentials || {};
  const field = (label, value, canReveal) => (
    <div className="mb-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-1">{label}</div>
      <div className="font-mono text-sm bg-slate-950 border border-slate-700 rounded px-3 py-2 break-all">
        {value ? (canReveal && !revealActive ? maskKey(value) : value) : "— not issued —"}
      </div>
    </div>
  );
  return (
    <div className="border border-slate-700 rounded-lg p-5 bg-slate-900 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs uppercase tracking-wide text-slate-500 font-medium">API credentials</div>
        <div className="flex items-center gap-2">
          {revealActive && (
            <span className="text-[10px] uppercase tracking-wide bg-amber-900/30 text-amber-300 border border-amber-700/50 rounded px-1.5">
              Visible · {fmtTime(revealRemaining)}
            </span>
          )}
          <button
            onClick={startReveal}
            disabled={!c.secret || revealActive}
            className="text-xs px-3 py-1 rounded border border-slate-600 hover:bg-slate-800 disabled:opacity-50"
          >
            Reveal secrets for 30s
          </button>
          <button className="text-xs px-3 py-1 rounded border border-slate-600 hover:bg-slate-800">
            Rotate secret
          </button>
        </div>
      </div>
      {field("Publishable key", c.publishable, false)}
      {field("Secret key", c.secret, true)}
      {field("Webhook signing secret", c.webhook_secret, true)}
      <div className="text-xs text-slate-400">
        Issued {c.issued_at ? fmtDateShort(c.issued_at) : "—"}. Rotating the secret key invalidates it
        immediately; webhook secret must be rotated separately.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collections dashboard — 4 KPIs, 7-day TPV chart, recent-10 table
// ---------------------------------------------------------------------------
function CollectionsDashboard({ data, currency = "KES" }) {
  const empty = !data || !data.recent || data.recent.length === 0;
  if (empty) {
    return (
      <EmptyDashboard
        title="No collections yet"
        subtitle="Once merchant APIs are called with collection payloads, they'll appear here. This usually happens within 48 hours of activation."
      />
    );
  }
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <KpiCard
          label="7-day TPV"
          value={fmtKES(data.tpv_7d_cents, currency)}
          sublabel="Gross collections processed"
        />
        <KpiCard
          label="Success rate"
          value={`${Math.round((data.success_rate || 0) * 100)}%`}
          sublabel="Last 7 days"
          tone={data.success_rate >= 0.9 ? "ok" : data.success_rate >= 0.8 ? "warn" : "danger"}
        />
        <KpiCard label="Pending" value={data.pending} sublabel="Awaiting callback" />
        <KpiCard label="Failed" value={data.failed} sublabel="Last 7 days" tone={data.failed > 10 ? "warn" : "info"} />
      </div>

      <div className="border border-slate-700 rounded-lg p-4 bg-slate-900 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wide text-slate-500 font-medium">Daily TPV · last 7 days</div>
          <div className="text-xs text-slate-400">Newest on right</div>
        </div>
        <Sparkline values={data.daily_tpv_cents || []} accent="bg-sky-500" />
      </div>

      <div className="border border-slate-700 rounded-lg bg-slate-900 overflow-x-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="text-sm font-medium text-slate-100">Recent collections</div>
          <div className="text-xs text-slate-400">Dual-state: business_status and internal_status</div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-950 border-b border-slate-700">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2 font-medium">ID</th>
              <th className="px-4 py-2 font-medium">Method</th>
              <th className="px-4 py-2 font-medium text-right">Amount</th>
              <th className="px-4 py-2 font-medium text-right">Fee</th>
              <th className="px-4 py-2 font-medium">business_status</th>
              <th className="px-4 py-2 font-medium">internal_status</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={r.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800">
                <td className="px-4 py-2 font-mono text-xs text-slate-300">{r.id}</td>
                <td className="px-4 py-2">
                  <div className="text-sm text-slate-200">{r.method}</div>
                  <div className="text-xs text-slate-400">{r.provider}</div>
                </td>
                <td className="px-4 py-2 text-right font-mono text-sm">{fmtKES(r.amount, currency)}</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-slate-400">
                  {fmtKES(r.fee, currency)}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                      r.business_status === "successful"
                        ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/50"
                        : r.business_status === "failed"
                        ? "bg-rose-900/30 text-rose-300 border-rose-700/50"
                        : r.business_status === "refunded"
                        ? "bg-amber-900/30 text-amber-300 border-amber-700/50"
                        : "bg-slate-800 text-slate-300 border-slate-700"
                    }`}
                  >
                    {r.business_status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs font-mono text-slate-400">{r.internal_status}</td>
                <td className="px-4 py-2 text-xs text-slate-400">
                  {fmtDateShort(r.created_at)} {fmtTimeShort(r.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payouts dashboard — 4 KPIs, 7-day volume chart, recent-10 table
// ---------------------------------------------------------------------------
function PayoutsDashboard({ data, currency = "KES" }) {
  const empty = !data || !data.recent || data.recent.length === 0;
  if (empty) {
    return (
      <EmptyDashboard
        title="No payouts yet"
        subtitle="Create a payout via the merchant API or the admin payouts page to see activity here."
      />
    );
  }
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <KpiCard
          label="7-day payout volume"
          value={fmtKES(data.volume_7d_cents, currency)}
          sublabel="Net disbursed"
        />
        <KpiCard
          label="Success rate"
          value={`${Math.round((data.success_rate || 0) * 100)}%`}
          sublabel="Last 7 days"
          tone={data.success_rate >= 0.95 ? "ok" : data.success_rate >= 0.85 ? "warn" : "danger"}
        />
        <KpiCard label="Pending" value={data.pending} sublabel="Queued or approving" />
        <KpiCard
          label="Reserved"
          value={fmtKES(data.reserved_cents, currency)}
          sublabel="Held against pending payouts"
        />
      </div>

      <div className="border border-slate-700 rounded-lg p-4 bg-slate-900 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wide text-slate-500 font-medium">
            Daily payout volume · last 7 days
          </div>
          <div className="text-xs text-slate-400">Newest on right</div>
        </div>
        <Sparkline values={data.daily_volume_cents || []} accent="bg-violet-500" />
      </div>

      <div className="border border-slate-700 rounded-lg bg-slate-900 overflow-x-auto">
        <div className="p-4 border-b border-slate-700">
          <div className="text-sm font-medium text-slate-100">Recent payouts</div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-950 border-b border-slate-700">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2 font-medium">ID</th>
              <th className="px-4 py-2 font-medium">Recipient</th>
              <th className="px-4 py-2 font-medium text-right">Amount</th>
              <th className="px-4 py-2 font-medium">Fee model</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={r.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800">
                <td className="px-4 py-2 font-mono text-xs text-slate-300">{r.id}</td>
                <td className="px-4 py-2 text-sm text-slate-200">{r.recipient}</td>
                <td className="px-4 py-2 text-right font-mono text-sm">{fmtKES(r.amount, currency)}</td>
                <td className="px-4 py-2 text-xs text-slate-400">{r.fee_model.replace("_", " ")}</td>
                <td className="px-4 py-2">
                  <span
                    className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                      r.status === "succeeded"
                        ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/50"
                        : r.status === "failed"
                        ? "bg-rose-900/30 text-rose-300 border-rose-700/50"
                        : r.status === "processing" || r.status === "pending_approval"
                        ? "bg-amber-900/30 text-amber-300 border-amber-700/50"
                        : "bg-slate-800 text-slate-300 border-slate-700"
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">
                  {fmtDateShort(r.created_at)} {fmtTimeShort(r.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settlements dashboard — 4 KPIs, 7-day balance chart, scheduled/settled table
// ---------------------------------------------------------------------------
function SettlementsDashboard({ data, currency = "KES" }) {
  const empty = !data || !data.recent || data.recent.length === 0;
  if (empty) {
    return (
      <EmptyDashboard
        title="No settlements yet"
        subtitle="Settlements run after the first cleared collection. The next scheduled run will appear here."
      />
    );
  }
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <KpiCard
          label="Available balance"
          value={fmtKES(data.available_cents, currency)}
          sublabel="Ready to settle"
          tone="ok"
        />
        <KpiCard
          label="Reserved"
          value={fmtKES(data.reserved_cents, currency)}
          sublabel="Held for risk / chargebacks"
        />
        <KpiCard
          label="Next settlement"
          value={data.next_date ? fmtDateShort(data.next_date) : "—"}
          sublabel="Scheduled run"
        />
        <KpiCard
          label="7-day settled"
          value={fmtKES(data.settled_7d_cents, currency)}
          sublabel="Disbursed to destinations"
        />
      </div>

      <div className="border border-slate-700 rounded-lg p-4 bg-slate-900 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wide text-slate-500 font-medium">
            Daily available balance · last 7 days
          </div>
          <div className="text-xs text-slate-400">Newest on right</div>
        </div>
        <Sparkline values={data.daily_balance_cents || []} accent="bg-emerald-500" />
      </div>

      <div className="border border-slate-700 rounded-lg bg-slate-900 overflow-x-auto">
        <div className="p-4 border-b border-slate-700">
          <div className="text-sm font-medium text-slate-100">Settlements (recent + scheduled)</div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-950 border-b border-slate-700">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2 font-medium">ID</th>
              <th className="px-4 py-2 font-medium">Sub-merchant</th>
              <th className="px-4 py-2 font-medium text-right">Amount</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={r.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800">
                <td className="px-4 py-2 font-mono text-xs text-slate-300">{r.id}</td>
                <td className="px-4 py-2 text-sm text-slate-200">{r.sub_merchant}</td>
                <td className="px-4 py-2 text-right font-mono text-sm">{fmtKES(r.amount, r.currency || currency)}</td>
                <td className="px-4 py-2">
                  <span
                    className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                      r.status === "settled"
                        ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/50"
                        : r.status === "scheduled"
                        ? "bg-sky-900/30 text-sky-300 border-sky-700/50"
                        : r.status === "failed"
                        ? "bg-rose-900/30 text-rose-300 border-rose-700/50"
                        : "bg-slate-800 text-slate-300 border-slate-700"
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">{fmtDateShort(r.settled_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyDashboard({ title, subtitle }) {
  return (
    <div className="border border-dashed border-slate-600 rounded-lg p-10 bg-slate-900 text-center">
      <div className="text-sm font-medium text-slate-300">{title}</div>
      <div className="text-xs text-slate-400 mt-1 max-w-md mx-auto">{subtitle}</div>
    </div>
  );
}

// ============================================================================
// v1.3.1 — Admin-level aggregated views (sibling to Compliance Review)
// ============================================================================
// Mirrors the backend's admin routes:
//   GET /admin/collections — all collections across all merchants
//   GET /admin/payouts     — all payouts across all merchants
//   GET /admin/wallets     — settlement balances across all merchants
// Top-level AdminNav shows 4 tabs (Compliance Review is the merchants table).
// Each aggregated dashboard rolls up KPIs (sum) + weights success rate by TPV
// + sums the 7-day sparkline arrays + flattens recent activity with a
// merchant column + offers a merchant-picker filter. Clicking a merchant name
// in the table drills through to that merchant's panel at the matching tab.
// ============================================================================

function AdminNav({ route, setRoute }) {
  const items = [
    { id: "list", label: "Compliance Review" },
    { id: "admin_collections", label: "Collections" },
    { id: "admin_payouts", label: "Payouts" },
    { id: "admin_settlements", label: "Settlements" },
  ];
  return (
    <div className="max-w-6xl mx-auto px-6 pt-4">
      <div className="border-b border-slate-800 flex items-center gap-1 flex-wrap">
        {items.map((it) => {
          const active = route === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setRoute(it.id)}
              className={`px-4 py-2 text-sm border-b-2 -mb-[2px] ${
                active
                  ? "border-slate-100 text-slate-100 font-medium"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Aggregation helpers ---------------------------------------------------
// Each returns an object shaped like the per-merchant activity shape so the
// existing dashboard components can render it, but with an added `recent[]`
// carrying merchant_id + merchant_name for the cross-merchant table.

function aggregateCollections(merchants) {
  const agg = {
    tpv_7d_cents: 0,
    pending: 0,
    failed: 0,
    daily_tpv_cents: [0, 0, 0, 0, 0, 0, 0],
    recent: [],
    _sr_num: 0,
    _sr_den: 0,
  };
  merchants.forEach((m) => {
    const c = m.activity?.collections;
    if (!c) return;
    agg.tpv_7d_cents += c.tpv_7d_cents || 0;
    agg.pending += c.pending || 0;
    agg.failed += c.failed || 0;
    (c.daily_tpv_cents || []).forEach((v, i) => {
      agg.daily_tpv_cents[i] = (agg.daily_tpv_cents[i] || 0) + v;
    });
    agg._sr_num += (c.success_rate || 0) * (c.tpv_7d_cents || 0);
    agg._sr_den += c.tpv_7d_cents || 0;
    (c.recent || []).forEach((r) =>
      agg.recent.push({ ...r, merchant_id: m.id, merchant_name: m.legal_name })
    );
  });
  agg.success_rate = agg._sr_den > 0 ? agg._sr_num / agg._sr_den : 0;
  agg.recent.sort((a, b) => String(b.created_at || "").localeCompare(a.created_at || ""));
  return agg;
}

function aggregatePayouts(merchants) {
  const agg = {
    volume_7d_cents: 0,
    pending: 0,
    reserved_cents: 0,
    daily_volume_cents: [0, 0, 0, 0, 0, 0, 0],
    recent: [],
    _sr_num: 0,
    _sr_den: 0,
  };
  merchants.forEach((m) => {
    const p = m.activity?.payouts;
    if (!p) return;
    agg.volume_7d_cents += p.volume_7d_cents || 0;
    agg.pending += p.pending || 0;
    agg.reserved_cents += p.reserved_cents || 0;
    (p.daily_volume_cents || []).forEach((v, i) => {
      agg.daily_volume_cents[i] = (agg.daily_volume_cents[i] || 0) + v;
    });
    agg._sr_num += (p.success_rate || 0) * (p.volume_7d_cents || 0);
    agg._sr_den += p.volume_7d_cents || 0;
    (p.recent || []).forEach((r) =>
      agg.recent.push({ ...r, merchant_id: m.id, merchant_name: m.legal_name })
    );
  });
  agg.success_rate = agg._sr_den > 0 ? agg._sr_num / agg._sr_den : 0;
  agg.recent.sort((a, b) => String(b.created_at || "").localeCompare(a.created_at || ""));
  return agg;
}

function aggregateSettlements(merchants) {
  const agg = {
    available_cents: 0,
    reserved_cents: 0,
    settled_7d_cents: 0,
    daily_balance_cents: [0, 0, 0, 0, 0, 0, 0],
    next_date: null,
    recent: [],
  };
  merchants.forEach((m) => {
    const s = m.activity?.settlements;
    if (!s) return;
    agg.available_cents += s.available_cents || 0;
    agg.reserved_cents += s.reserved_cents || 0;
    agg.settled_7d_cents += s.settled_7d_cents || 0;
    (s.daily_balance_cents || []).forEach((v, i) => {
      agg.daily_balance_cents[i] = (agg.daily_balance_cents[i] || 0) + v;
    });
    if (s.next_date && (!agg.next_date || s.next_date < agg.next_date)) {
      agg.next_date = s.next_date;
    }
    (s.recent || []).forEach((r) =>
      agg.recent.push({ ...r, merchant_id: m.id, merchant_name: m.legal_name })
    );
  });
  agg.recent.sort((a, b) => String(b.settled_at || "").localeCompare(a.settled_at || ""));
  return agg;
}

// --- Filter bar (shared across admin dashboards) ---------------------------
function AdminFilterBar({ merchants, selected, onChange, children }) {
  return (
    <div className="flex items-center gap-3 mb-5 flex-wrap">
      <label className="text-xs text-slate-400">Merchant</label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-900 text-slate-100 border border-slate-700 rounded-md px-3 py-2 text-sm"
      >
        <option value="all">All merchants ({merchants.length})</option>
        {merchants.map((m) => (
          <option key={m.id} value={m.id}>
            {m.legal_name}
          </option>
        ))}
      </select>
      {children}
    </div>
  );
}

// --- AdminCollectionsView ---------------------------------------------------
function AdminCollectionsView({ merchants, openMerchant }) {
  const [merchantFilter, setMerchantFilter] = useState("all");
  const subset = merchantFilter === "all" ? merchants : merchants.filter((m) => m.id === merchantFilter);
  const data = aggregateCollections(subset);
  const empty = data.recent.length === 0;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Collections — aggregated</h1>
          <p className="text-sm text-slate-400 mt-1">
            Rolled up across {subset.length} merchant{subset.length === 1 ? "" : "s"}. Rows link into
            the individual merchant panel.
          </p>
        </div>
      </div>

      <AdminFilterBar merchants={merchants} selected={merchantFilter} onChange={setMerchantFilter} />

      {empty ? (
        <EmptyDashboard
          title="No collection activity in scope"
          subtitle="Adjust the merchant filter, or wait for collections to process."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
            <KpiCard label="7-day TPV" value={fmtKES(data.tpv_7d_cents)} sublabel="Gross collections" />
            <KpiCard
              label="Success rate (TPV-weighted)"
              value={`${Math.round(data.success_rate * 100)}%`}
              sublabel="Last 7 days"
              tone={data.success_rate >= 0.9 ? "ok" : data.success_rate >= 0.8 ? "warn" : "danger"}
            />
            <KpiCard label="Pending" value={data.pending} sublabel="Across merchants" />
            <KpiCard label="Failed" value={data.failed} sublabel="Last 7 days" tone={data.failed > 30 ? "warn" : "info"} />
          </div>

          <div className="border border-slate-700 rounded-lg p-4 bg-slate-900 mb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-wide text-slate-500 font-medium">
                Daily TPV (summed) · last 7 days
              </div>
              <div className="text-xs text-slate-400">Newest on right</div>
            </div>
            <Sparkline values={data.daily_tpv_cents} accent="bg-sky-500" />
          </div>

          <div className="border border-slate-700 rounded-lg bg-slate-900 overflow-x-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="text-sm font-medium text-slate-100">Recent collections (all merchants)</div>
              <div className="text-xs text-slate-400">{data.recent.length} in window</div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-800 border-b border-slate-700">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-medium">ID</th>
                  <th className="px-4 py-2 font-medium">Merchant</th>
                  <th className="px-4 py-2 font-medium">Method</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium">business_status</th>
                  <th className="px-4 py-2 font-medium">internal_status</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.slice(0, 30).map((r) => (
                  <tr key={r.id + r.merchant_id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800">
                    <td className="px-4 py-2 font-mono text-xs text-slate-300">{r.id}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => openMerchant(r.merchant_id, "collections")}
                        className="text-sm text-sky-300 hover:underline"
                      >
                        {r.merchant_name}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-sm text-slate-200">{r.method}</div>
                      <div className="text-xs text-slate-500">{r.provider}</div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-sm">{fmtKES(r.amount)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                          r.business_status === "successful"
                            ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/50"
                            : r.business_status === "failed"
                            ? "bg-rose-900/30 text-rose-300 border-rose-700/50"
                            : r.business_status === "refunded"
                            ? "bg-amber-900/30 text-amber-300 border-amber-700/50"
                            : "bg-slate-800 text-slate-300 border-slate-700"
                        }`}
                      >
                        {r.business_status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-slate-400">{r.internal_status}</td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {fmtDateShort(r.created_at)} {fmtTimeShort(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// --- AdminPayoutsView -------------------------------------------------------
function AdminPayoutsView({ merchants, openMerchant }) {
  const [merchantFilter, setMerchantFilter] = useState("all");
  const subset = merchantFilter === "all" ? merchants : merchants.filter((m) => m.id === merchantFilter);
  const data = aggregatePayouts(subset);
  const empty = data.recent.length === 0;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Payouts — aggregated</h1>
          <p className="text-sm text-slate-400 mt-1">
            Rolled up across {subset.length} merchant{subset.length === 1 ? "" : "s"}.
          </p>
        </div>
      </div>

      <AdminFilterBar merchants={merchants} selected={merchantFilter} onChange={setMerchantFilter} />

      {empty ? (
        <EmptyDashboard
          title="No payout activity in scope"
          subtitle="Adjust the merchant filter, or wait for payouts to be created."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
            <KpiCard label="7-day payout volume" value={fmtKES(data.volume_7d_cents)} sublabel="Net disbursed" />
            <KpiCard
              label="Success rate (volume-weighted)"
              value={`${Math.round(data.success_rate * 100)}%`}
              sublabel="Last 7 days"
              tone={data.success_rate >= 0.95 ? "ok" : data.success_rate >= 0.85 ? "warn" : "danger"}
            />
            <KpiCard label="Pending" value={data.pending} sublabel="Across merchants" />
            <KpiCard label="Reserved" value={fmtKES(data.reserved_cents)} sublabel="Held" />
          </div>

          <div className="border border-slate-700 rounded-lg p-4 bg-slate-900 mb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-wide text-slate-500 font-medium">
                Daily payout volume (summed) · last 7 days
              </div>
              <div className="text-xs text-slate-400">Newest on right</div>
            </div>
            <Sparkline values={data.daily_volume_cents} accent="bg-violet-500" />
          </div>

          <div className="border border-slate-700 rounded-lg bg-slate-900 overflow-x-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="text-sm font-medium text-slate-100">Recent payouts (all merchants)</div>
              <div className="text-xs text-slate-400">{data.recent.length} in window</div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-800 border-b border-slate-700">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-medium">ID</th>
                  <th className="px-4 py-2 font-medium">Merchant</th>
                  <th className="px-4 py-2 font-medium">Recipient</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium">Fee model</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.slice(0, 30).map((r) => (
                  <tr key={r.id + r.merchant_id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800">
                    <td className="px-4 py-2 font-mono text-xs text-slate-300">{r.id}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => openMerchant(r.merchant_id, "payouts")}
                        className="text-sm text-sky-300 hover:underline"
                      >
                        {r.merchant_name}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-200">{r.recipient}</td>
                    <td className="px-4 py-2 text-right font-mono text-sm">{fmtKES(r.amount)}</td>
                    <td className="px-4 py-2 text-xs text-slate-400">{r.fee_model?.replace("_", " ")}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                          r.status === "succeeded"
                            ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/50"
                            : r.status === "failed"
                            ? "bg-rose-900/30 text-rose-300 border-rose-700/50"
                            : r.status === "processing" || r.status === "pending_approval"
                            ? "bg-amber-900/30 text-amber-300 border-amber-700/50"
                            : "bg-slate-800 text-slate-300 border-slate-700"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {fmtDateShort(r.created_at)} {fmtTimeShort(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// --- AdminSettlementsView ---------------------------------------------------
function AdminSettlementsView({ merchants, openMerchant }) {
  const [merchantFilter, setMerchantFilter] = useState("all");
  const subset = merchantFilter === "all" ? merchants : merchants.filter((m) => m.id === merchantFilter);
  const data = aggregateSettlements(subset);
  const empty = data.recent.length === 0;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Settlements — aggregated</h1>
          <p className="text-sm text-slate-400 mt-1">
            Settlement balances and movements across {subset.length} merchant{subset.length === 1 ? "" : "s"}.
          </p>
        </div>
      </div>

      <AdminFilterBar merchants={merchants} selected={merchantFilter} onChange={setMerchantFilter} />

      {empty ? (
        <EmptyDashboard
          title="No settlement activity in scope"
          subtitle="Adjust the merchant filter or wait for the next settlement run."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
            <KpiCard label="Available balance" value={fmtKES(data.available_cents)} sublabel="Ready to settle" tone="ok" />
            <KpiCard label="Reserved" value={fmtKES(data.reserved_cents)} sublabel="Held for risk" />
            <KpiCard
              label="Next settlement"
              value={data.next_date ? fmtDateShort(data.next_date) : "—"}
              sublabel="Earliest scheduled"
            />
            <KpiCard label="7-day settled" value={fmtKES(data.settled_7d_cents)} sublabel="Disbursed" />
          </div>

          <div className="border border-slate-700 rounded-lg p-4 bg-slate-900 mb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-wide text-slate-500 font-medium">
                Daily available balance (summed) · last 7 days
              </div>
              <div className="text-xs text-slate-400">Newest on right</div>
            </div>
            <Sparkline values={data.daily_balance_cents} accent="bg-emerald-500" />
          </div>

          <div className="border border-slate-700 rounded-lg bg-slate-900 overflow-x-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="text-sm font-medium text-slate-100">Settlements (recent + scheduled, all merchants)</div>
              <div className="text-xs text-slate-400">{data.recent.length} in window</div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-800 border-b border-slate-700">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-medium">ID</th>
                  <th className="px-4 py-2 font-medium">Merchant</th>
                  <th className="px-4 py-2 font-medium">Sub-merchant</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.slice(0, 30).map((r) => (
                  <tr key={r.id + r.merchant_id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800">
                    <td className="px-4 py-2 font-mono text-xs text-slate-300">{r.id}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => openMerchant(r.merchant_id, "settlements")}
                        className="text-sm text-sky-300 hover:underline"
                      >
                        {r.merchant_name}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-200">{r.sub_merchant}</td>
                    <td className="px-4 py-2 text-right font-mono text-sm">{fmtKES(r.amount, r.currency || "KES")}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                          r.status === "settled"
                            ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/50"
                            : r.status === "scheduled"
                            ? "bg-sky-900/30 text-sky-300 border-sky-700/50"
                            : r.status === "failed"
                            ? "bg-rose-900/30 text-rose-300 border-rose-700/50"
                            : "bg-slate-800 text-slate-300 border-slate-700"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400">{fmtDateShort(r.settled_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ----- mount ---------------------------------------------------------------

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
