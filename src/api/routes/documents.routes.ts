/**
 * Document upload routes — §3.4 / §12.1.
 *
 *   POST /v1/merchants/:merchantId/documents     multipart/form-data
 *   GET  /v1/merchants/:merchantId/documents     list
 *   GET  /v1/merchants/:merchantId/documents/:id detail
 */
import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireSecretKey } from '@/api/middleware/authenticate';
import { success } from '@/infra/response';
import { OgunError } from '@/infra/errors';
import {
  uploadDocument,
  getDocument,
  listDocuments,
  SUPPORTED_DOCUMENT_TYPES,
  DocumentType,
} from '@/modules/document/document.service';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB cap, enforced again in service
});

function shape(d: Awaited<ReturnType<typeof getDocument>>) {
  return {
    id: d.id,
    merchant_id: d.merchant_id,
    sub_merchant_id: d.sub_merchant_id,
    type: d.type,
    file_url: d.file_url,
    file_hash: d.file_hash,
    review_status: d.review_status,
    extracted_data: d.extracted_data,
    extraction_confidence: d.extraction_confidence,
    uploaded_at: d.uploaded_at,
  };
}

router.post(
  '/merchants/:merchantId/documents',
  authenticate(),
  upload.single('file'),
  async (req, res, next) => {
    try {
      requireSecretKey(req);
      if (req.params.merchantId !== req.ogunContext.principal!.merchantId) {
        throw OgunError.notFound('Merchant', req.params.merchantId);
      }
      const file = req.file;
      if (!file) {
        throw OgunError.invalidRequest('Missing file field in multipart body');
      }
      const rawType = (req.body as Record<string, unknown>).type;
      const type = typeof rawType === 'string' ? rawType : '';
      if (!SUPPORTED_DOCUMENT_TYPES.includes(type as DocumentType)) {
        throw OgunError.invalidRequest(
          `Field "type" must be one of: ${SUPPORTED_DOCUMENT_TYPES.join(', ')}`,
        );
      }
      const subId = (req.body as Record<string, unknown>).sub_merchant_id;
      const doc = await uploadDocument({
        merchant_id: req.params.merchantId,
        sub_merchant_id: typeof subId === 'string' ? subId : undefined,
        type: type as DocumentType,
        original_name: file.originalname,
        content_type: file.mimetype,
        body: file.buffer,
      });
      res.status(201).json(
        success(shape(doc), {
          request_id: req.ogunContext.requestId,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get('/merchants/:merchantId/documents', authenticate(), async (req, res, next) => {
  try {
    if (req.params.merchantId !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('Merchant', req.params.merchantId);
    }
    const docs = await listDocuments(req.params.merchantId);
    res.json(success(docs.map(shape), { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.get(
  '/merchants/:merchantId/documents/:id',
  authenticate(),
  async (req, res, next) => {
    try {
      if (req.params.merchantId !== req.ogunContext.principal!.merchantId) {
        throw OgunError.notFound('Merchant', req.params.merchantId);
      }
      const d = await getDocument(req.params.merchantId, req.params.id);
      res.json(success(shape(d), { request_id: req.ogunContext.requestId }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
