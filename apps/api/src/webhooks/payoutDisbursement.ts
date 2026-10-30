import type { Pool } from "pg";

/** Operational record of a payout-rail instruction for a settlement batch. */
export async function recordPayoutDisbursementEffect(
  pool: Pool,
  settlementBatchId: string,
  amountFils: number,
): Promise<void> {
  if (amountFils <= 0) {
    // Void batches (zero or negative net) carry no payout instruction.
    return;
  }

  await pool.query(
    // One instruction per paid batch. This runs as a pre-delivery effect of
    // every settlement.paid delivery (one per endpoint, retried after a
    // crash, repeated if the event was enqueued twice), so it has to be
    // idempotent: the unique index on settlement_batch_id (migration 0075)
    // turns every repeat into a no-op instead of another payout instruction.
    `INSERT INTO settlement_payout_disbursements (settlement_batch_id, amount_fils, disbursement_reference)
     VALUES ($1, $2, 'disb_' || gen_random_uuid())
     ON CONFLICT (settlement_batch_id) DO NOTHING`,
    [settlementBatchId, amountFils],
  );
}
