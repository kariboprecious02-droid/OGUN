/**
 * Settlement report renderer — Execution Spec §7.5.
 *
 * Generates a PDF document with:
 *   - Merchant + sub-merchant header
 *   - Settlement ID, reference, period
 *   - Gross, fees, settlement fee, refund adjustments, net
 *   - Transaction count, destination bank, status, timestamps
 *
 * The rendered PDF is streamed into the storage adapter (so local dev
 * writes to `.ogun-storage/`, prod writes to S3) and the resulting URL
 * + metadata is returned for persistence in the settlements row.
 */

import PDFDocument from 'pdfkit';
import { getStorage } from '@/infra/storage';
import { query } from '@/infra/db/pool';

type SettlementForReport = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  period_start: Date;
  period_end: Date;
  gross_amount: string | number;
  fee_amount: string | number;
  settlement_fee: string | number;
  refund_adjustment_amount: string | number;
  other_adjustment_amount: string | number;
  net_amount: string | number;
  transaction_count: number;
  status: string;
  payout_id: string | null;
  destination_summary: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  merchant_legal_name: string;
  sub_merchant_name: string;
};

async function loadSettlementForReport(
  settlementId: string,
): Promise<SettlementForReport | null> {
  const { rows } = await query<SettlementForReport>(
    `SELECT s.*, m.legal_name AS merchant_legal_name, sm.name AS sub_merchant_name
       FROM settlements s
       JOIN merchants m ON m.id = s.merchant_id
       JOIN sub_merchants sm ON sm.id = s.sub_merchant_id
      WHERE s.id = $1
      LIMIT 1`,
    [settlementId],
  );
  return rows[0] ?? null;
}

function formatCents(amount: string | number): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  return (n / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 });
}

/**
 * Render the settlement PDF to a Buffer. Public for test use.
 */
export async function renderSettlementPdf(settlementId: string): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const settlement = await loadSettlementForReport(settlementId);
  if (!settlement) throw new Error(`Settlement ${settlementId} not found`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', (err: Error) => reject(err));
  });

  // Header
  doc.fontSize(22).font('Helvetica-Bold').text('Ogun Settlement Report', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica').fillColor('#555555').text(
    `Generated ${new Date().toISOString()}`,
  );
  doc.moveDown(1);
  doc.fillColor('black');

  // Merchant block
  doc.fontSize(12).font('Helvetica-Bold').text('Merchant');
  doc.font('Helvetica').fontSize(11).text(settlement.merchant_legal_name);
  doc.text(`Sub-merchant: ${settlement.sub_merchant_name}`);
  doc.moveDown(0.5);

  // Settlement block
  doc.font('Helvetica-Bold').fontSize(12).text('Settlement');
  doc.font('Helvetica').fontSize(11);
  doc.text(`ID:     ${settlement.id}`);
  doc.text(
    `Period: ${settlement.period_start.toISOString().slice(0, 10)} → ${settlement.period_end
      .toISOString()
      .slice(0, 10)}`,
  );
  doc.text(`Status: ${settlement.status}`);
  if (settlement.payout_id) {
    doc.text(`Payout: ${settlement.payout_id}`);
  }
  doc.moveDown(0.5);

  // Destination
  if (settlement.destination_summary) {
    doc.font('Helvetica-Bold').fontSize(12).text('Destination');
    doc.font('Helvetica').fontSize(11);
    for (const [k, v] of Object.entries(settlement.destination_summary)) {
      doc.text(`${k}: ${String(v)}`);
    }
    doc.moveDown(0.5);
  }

  // Amounts table
  doc.font('Helvetica-Bold').fontSize(12).text('Amounts (KES)');
  doc.font('Helvetica').fontSize(11);
  const table: Array<[string, string]> = [
    [`Gross successful collections`, formatCents(settlement.gross_amount)],
    [`Processing fees`, `- ${formatCents(settlement.fee_amount)}`],
    [`Settlement fee`, `- ${formatCents(settlement.settlement_fee)}`],
    [`Refund adjustments`, `- ${formatCents(settlement.refund_adjustment_amount)}`],
    [`Other adjustments`, `- ${formatCents(settlement.other_adjustment_amount)}`],
  ];
  for (const [label, value] of table) {
    const y = doc.y;
    doc.text(label, 60, y);
    doc.text(value, 350, y, { width: 180, align: 'right' });
    doc.moveDown(0.2);
  }
  doc.moveDown(0.3);
  doc.moveTo(60, doc.y).lineTo(540, doc.y).strokeColor('#888888').stroke();
  doc.moveDown(0.3);
  const netY = doc.y;
  doc.font('Helvetica-Bold').fontSize(13);
  doc.text('Net settled', 60, netY);
  doc.text(`KES ${formatCents(settlement.net_amount)}`, 350, netY, {
    width: 180,
    align: 'right',
  });
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(11).text(`Transaction count: ${settlement.transaction_count}`);

  doc.moveDown(1.5);
  doc
    .fontSize(9)
    .fillColor('#888888')
    .text(
      'Ogun Payment Infrastructure Platform · Confidential · This document contains a summary of amounts settled for the period shown above.',
      { align: 'center' },
    );

  doc.end();
  await finished;

  const buffer = Buffer.concat(chunks);
  return {
    buffer,
    filename: `settlement-${settlement.id}.pdf`,
  };
}

/**
 * Render the PDF and persist it via the configured storage adapter.
 * Updates settlements.report_url on success.
 */
export async function generateAndStoreReport(
  settlementId: string,
): Promise<{ report_url: string; sha256: string; size: number }> {
  const { buffer, filename } = await renderSettlementPdf(settlementId);
  const storage = getStorage();
  const key = `settlements/${settlementId}/${filename}`;
  const stored = await storage.putObject({
    key,
    body: buffer,
    contentType: 'application/pdf',
    metadata: { settlement_id: settlementId },
  });
  await query(`UPDATE settlements SET report_url = $2, updated_at = now() WHERE id = $1`, [
    settlementId,
    stored.url,
  ]);
  return {
    report_url: stored.url,
    sha256: stored.sha256,
    size: stored.size,
  };
}

/**
 * Presigned URL helper used by GET /v1/settlements/:id/report.
 */
export async function getReportUrl(settlementId: string): Promise<string | null> {
  const { rows } = await query<{ report_url: string | null }>(
    `SELECT report_url FROM settlements WHERE id = $1`,
    [settlementId],
  );
  const stored = rows[0]?.report_url ?? null;
  if (!stored) return null;
  // For the local adapter the stored URL is a file:// URL which is
  // already accessible on the server; for S3 we would call
  // getPresignedUrl(key) to mint a time-limited URL.
  return stored;
}
