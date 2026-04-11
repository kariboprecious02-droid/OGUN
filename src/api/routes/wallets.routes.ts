import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '@/api/validation';
import { authenticate, requireSecretKey } from '@/api/middleware/authenticate';
import { idempotency } from '@/api/middleware/idempotency';
import { success } from '@/infra/response';
import { listWallets, topupPayoutWallet } from '@/modules/wallet/wallet.service';

const router = Router();

router.get('/wallets', authenticate(), async (req, res, next) => {
  try {
    const wallets = await listWallets(req.ogunContext.principal!.merchantId);
    res.json(
      success(
        wallets.map((w) => ({
          id: w.id,
          sub_merchant_id: w.sub_merchant_id,
          wallet_type: w.wallet_type,
          currency: w.currency,
          available_balance: w.available_balance,
          reserved_balance: w.reserved_balance,
          status: w.status,
        })),
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

const topupBody = z.object({
  sub_merchant_id: z.string().startsWith('smrc_'),
  amount: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  reference: z.string().max(100),
});

router.post(
  '/wallets/payout/topups',
  authenticate(),
  idempotency('POST /wallets/payout/topups', { required: true }),
  async (req, res, next) => {
    try {
      requireSecretKey(req);
      const body = parseBody(topupBody, req.body);
      const result = await topupPayoutWallet({
        merchantId: req.ogunContext.principal!.merchantId,
        subMerchantId: body.sub_merchant_id,
        amount: body.amount,
        currency: body.currency,
        reference: body.reference,
        idempotencyKey:
          req.ogunContext.idempotencyKey ?? `topup:${body.sub_merchant_id}:${body.reference}`,
      });
      res.status(201).json(
        success(result, {
          request_id: req.ogunContext.requestId,
          idempotency_key: req.ogunContext.idempotencyKey,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
