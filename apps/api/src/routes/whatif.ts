import type { FastifyInstance } from "fastify";
import { requireMerchantAuth } from "../auth/requireMerchantAuth.js";
import { BadRequestError } from "../lib/errors.js";
import { simulateForMerchant } from "../whatif/simulateForMerchant.js";
import type { Scenario } from "../whatif/feeReplay.js";

interface FeeSimulationQuery {
  volumeChangePct?: string;
  mdrBps?: string;
  discountBps?: string;
}

function parseOptionalInt(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!/^-?\d+$/.test(raw)) {
    throw new BadRequestError("invalid_request", `${name} must be a whole number`);
  }
  return Number.parseInt(raw, 10);
}

/**
 * Read-only "What if?" fee simulator, registered with prefix
 * '/v1/simulations'. Replays the caller's own captured transactions from the
 * last 90 days under a proposed volume, MDR and discount. Changes nothing.
 * Any authenticated merchant user may read it; the merchant id always comes
 * from the auth context.
 */
export async function whatIfRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: FeeSimulationQuery }>(
    "/fees",
    { preHandler: requireMerchantAuth },
    async (request) => {
      const q = request.query;
      const requested: Partial<Scenario> = {
        volumeChangePct: parseOptionalInt("volumeChangePct", q.volumeChangePct),
        mdrBps: parseOptionalInt("mdrBps", q.mdrBps),
        discountBps: parseOptionalInt("discountBps", q.discountBps),
      };

      try {
        return await simulateForMerchant(app.db, request.merchantAuth!.merchantId, requested);
      } catch (err) {
        if (err instanceof RangeError) {
          throw new BadRequestError("invalid_request", err.message);
        }
        throw err;
      }
    },
  );
}
