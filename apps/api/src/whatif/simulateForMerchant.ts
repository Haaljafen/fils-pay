import type { Pool } from "pg";
import { toFils, type Fils } from "@filspay/money";
import { getEffectiveMdrBps } from "../fees/feeSchedule.js";
import { getVolumeTierBonusBps } from "../fees/platformVolumeTier.js";
import { NotFoundError } from "../lib/errors.js";
import {
  REPLAY_WINDOW_DAYS,
  replayFees,
  type Scenario,
  type SimulationResult,
} from "./feeReplay.js";

/**
 * Loads a merchant's captured transactions from the last REPLAY_WINDOW_DAYS
 * and replays them under the scenario. Read-only: it takes no write locks
 * and changes no fee, schedule or payout. The merchant comes from the
 * caller's auth context, never from a request parameter.
 */
export async function simulateForMerchant(
  pool: Pool,
  merchantId: string,
  requested: Partial<Scenario>,
): Promise<SimulationResult & { currentMdrBps: number; discountBps: number; appliedScenario: Scenario }> {
  const client = await pool.connect();
  try {
    const merchant = await client.query<{ mdr_bps: number; negotiated_discount_bps: number }>(
      `SELECT mdr_bps, negotiated_discount_bps FROM merchants WHERE id = $1`,
      [merchantId],
    );
    const row = merchant.rows[0];
    if (!row) {
      throw new NotFoundError("merchant_not_found");
    }

    const now = new Date();
    const currentMdrBps = await getEffectiveMdrBps(client, merchantId, now, row.mdr_bps);
    const volumeTierBonusBps = await getVolumeTierBonusBps(client);

    // pg returns BIGINT as a string; keep it exact and convert at the edge.
    const captured = await client.query<{ captured_fils: string }>(
      `SELECT captured_fils
         FROM transactions
        WHERE merchant_id = $1
          AND captured_fils > 0
          AND occurred_at >= now() - ($2::int * interval '1 day')`,
      [merchantId, REPLAY_WINDOW_DAYS],
    );
    const amounts: Fils[] = captured.rows.map((r) => toFils(Number(r.captured_fils)));

    // Anything not asked for keeps today's value, so "change only the MDR"
    // is a valid question.
    const scenario: Scenario = {
      volumeChangePct: requested.volumeChangePct ?? 0,
      mdrBps: requested.mdrBps ?? currentMdrBps,
      discountBps: requested.discountBps ?? row.negotiated_discount_bps,
    };

    const result = replayFees(
      amounts,
      {
        mdrBps: currentMdrBps,
        volumeTierBonusBps,
        discountBps: row.negotiated_discount_bps,
      },
      scenario,
    );

    return { ...result, currentMdrBps, discountBps: row.negotiated_discount_bps, appliedScenario: scenario };
  } finally {
    client.release();
  }
}
