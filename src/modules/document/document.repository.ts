import { query } from '@/infra/db/pool';

export type DocumentRow = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string | null;
  type: string;
  file_url: string;
  file_hash: string | null;
  extracted_data: Record<string, unknown> | null;
  extraction_confidence: number | null;
  review_status: 'pending' | 'reviewed' | 'flagged';
  uploader_id: string | null;
  uploaded_at: Date;
};

export async function insertDocument(row: {
  id: string;
  merchant_id: string;
  sub_merchant_id?: string | null;
  type: string;
  file_url: string;
  file_hash?: string | null;
  uploader_id?: string | null;
}): Promise<DocumentRow> {
  const { rows } = await query<DocumentRow>(
    `INSERT INTO documents
       (id, merchant_id, sub_merchant_id, type, file_url, file_hash, uploader_id, review_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
     RETURNING *`,
    [
      row.id,
      row.merchant_id,
      row.sub_merchant_id ?? null,
      row.type,
      row.file_url,
      row.file_hash ?? null,
      row.uploader_id ?? null,
    ],
  );
  return rows[0];
}

export async function findDocument(id: string): Promise<DocumentRow | null> {
  const { rows } = await query<DocumentRow>(
    `SELECT * FROM documents WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listDocumentsByMerchant(
  merchantId: string,
): Promise<DocumentRow[]> {
  const { rows } = await query<DocumentRow>(
    `SELECT * FROM documents WHERE merchant_id = $1 ORDER BY uploaded_at DESC`,
    [merchantId],
  );
  return rows;
}
