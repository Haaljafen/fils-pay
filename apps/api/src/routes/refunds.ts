import type { FastifyInstance, FastifyRequest } from "fastify";
import { toFils } from "@filspay/money";
import { requireMerchantAuth, requireMerchantRole, requireMerchantWriterActor } from "../auth/requireMerchantAuth.js";
import { BadRequestError } from "../lib/errors.js";
import { assertRefundRequestScope, initiateMerchantRefund } from "../refunds/initiateMerchantRefund.js";

interface RefundParams {
  merchantId: string;
}

interface RefundBody {
  transactionId?: string;
  /** Omitted: refund everything still refundable. */
  amountFils?: number;
  reason?: string;
}

function getIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) {
    throw new BadRequestError("idempotency_key_required", "Idempotency-Key header is required");
  }
  return key;
}

/**
 * `POST /v1/merchants/:merchantId/refunds` — full or partial refund of one of
 * the merchant's captured transactions. Money moves, so owner/finance only
 * (API keys carry owner authority); `support` reads. The merchant comes from
 * the authenticated session or key and must match the path.
 */
export async function refundRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: RefundParams; Body: RefundBody }>(
    "/:merchantId/refunds",
    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
    async (request, reply) => {
      const auth = request.merchantAuth!;
      assertRefundRequestScope(auth, request.params.merchantId);
      const idempotencyKey = getIdempotencyKey(request);

      const { transactionId, amountFils, reason } = request.body ?? {};
      if (typeof transactionId !== "string" || transactionId === "") {
        throw new BadRequestError("invalid_request", "transactionId is required");
      }
      let amount;
      if (amountFils !== undefined) {
        try {
          amount = toFils(amountFils);
        } catch (err) {
          throw new BadRequestError("invalid_amount", err instanceof Error ? err.message : String(err));
        }
      }
      if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
        throw new BadRequestError("invalid_request", "reason must be a string of at most 500 characters");
      }

      const result = await initiateMerchantRefund(app.db, app.acquirer, {
        merchantId: auth.merchantId,
        transactionId,
        amountFils: amount,
        idempotencyKey,
        actor: requireMerchantWriterActor(auth),
        reason,
      });
      reply.code(result.statusCode).send(result.body);
    },
  );
}
