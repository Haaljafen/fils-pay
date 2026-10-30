import type { Pool } from "pg";
import { sweepStuckPaymentLinks } from "./sweep.js";

export interface PaymentLinkSweepHandle {
  stop(): Promise<void>;
}

/**
 * Runs `sweepStuckPaymentLinks` on an interval. Started from `index.ts`, never
 * from `buildApp()`, so route tests get no background timer. A pass that is
 * still running is not overlapped by the next tick.
 */
export function startPaymentLinkSweep(
  pool: Pool,
  config: { paymentLinkReservationTimeoutSeconds: number; paymentLinkSweepIntervalMs: number },
): PaymentLinkSweepHandle {
  let running: Promise<void> | null = null;
  let stopped = false;

  const pass = (): void => {
    if (stopped || running) return;
    running = sweepStuckPaymentLinks(pool, config)
      .then((result) => {
        if (result.finalized + result.released + result.unresolved.length > 0) {
          console.log(
            `[paymentLinks/sweep] finalized=${result.finalized} released=${result.released} skipped=${result.skipped}`,
          );
        }
        for (const u of result.unresolved) {
          console.error(
            `[paymentLinks/sweep] link ${u.linkId} still reserved: transaction ${u.transactionId} is '${u.transactionStatus}', needs a person`,
          );
        }
      })
      .catch((err: unknown) => {
        console.error("[paymentLinks/sweep] pass failed", err);
      })
      .finally(() => {
        running = null;
      });
  };

  const interval = setInterval(pass, config.paymentLinkSweepIntervalMs);

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(interval);
      await running;
    },
  };
}
