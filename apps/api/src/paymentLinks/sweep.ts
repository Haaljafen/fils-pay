import type { Pool, PoolClient } from "pg";

/**
 * Resolves payment links left 'reserved' by a pay attempt that recorded its
 * transaction (pending_transaction_id) and then died before the finalize
 * write (bug 90). `pay.ts` never reclaims such a link, so without this sweep
 * the link would stay blocked. Each stuck link is settled from the state of
 * its own transaction:
 *
 * - captured (or anything after a capture): the money moved, so the link is
 *   finalized as paid against that transaction.
 * - authorized or voided: no money moved, so the reservation is released and
 *   the link is payable again.
 * - anything else (for example partially_captured): left alone and reported,
 *   because a person has to decide what it means for the link.
 *
 * A link is only touched while holding the same per-token advisory lock that
 * `payPaymentLink` takes. If a live attempt holds it, the link is skipped
 * and the next pass retries it.
 */

/** Transaction statuses that prove a capture happened. */
const CAPTURED_STATUSES = new Set(["captured", "partially_refunded", "refunded", "chargeback"]);
/** Transaction statuses where no money moved, so the link can be released. */
const RELEASABLE_STATUSES = new Set(["authorized", "voided"]);

export interface SweepResult {
  finalized: number;
  released: number;
  skipped: number;
  unresolved: Array<{ linkId: string; transactionId: string; transactionStatus: string }>;
}

interface StuckLinkRow {
  id: string;
  token: string;
  pending_transaction_id: string;
  transaction_status: string;
}

export async function sweepStuckPaymentLinks(
  pool: Pool,
  config: { paymentLinkReservationTimeoutSeconds: number },
): Promise<SweepResult> {
  const result: SweepResult = { finalized: 0, released: 0, skipped: 0, unresolved: [] };

  const stuck = await pool.query<StuckLinkRow>(
    `SELECT l.id, l.token, l.pending_transaction_id, t.status AS transaction_status
       FROM payment_links l
       JOIN transactions t ON t.id = l.pending_transaction_id
      WHERE l.status = 'reserved'
        AND l.reserved_at < now() - ($1 || ' seconds')::interval`,
    [config.paymentLinkReservationTimeoutSeconds],
  );

  for (const row of stuck.rows) {
    if (CAPTURED_STATUSES.has(row.transaction_status)) {
      const done = await settleUnderLock(pool, row, (client) => finalizePaid(client, row));
      if (done === "skipped") result.skipped += 1;
      else result.finalized += 1;
    } else if (RELEASABLE_STATUSES.has(row.transaction_status)) {
      const done = await settleUnderLock(pool, row, (client) => releaseLink(client, row));
      if (done === "skipped") result.skipped += 1;
      else result.released += 1;
    } else {
      result.unresolved.push({
        linkId: row.id,
        transactionId: row.pending_transaction_id,
        transactionStatus: row.transaction_status,
      });
    }
  }

  return result;
}

/**
 * Runs `work` on a connection that holds the link's advisory lock. Returns
 * 'skipped' when a live attempt already holds it.
 */
async function settleUnderLock(
  pool: Pool,
  row: StuckLinkRow,
  work: (client: PoolClient) => Promise<void>,
): Promise<"done" | "skipped"> {
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`, [row.token]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return "skipped";
    await work(client);
    return "done";
  } finally {
    if (locked) {
      await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [row.token]).catch(() => undefined);
    }
    client.release();
  }
}

async function finalizePaid(client: PoolClient, row: StuckLinkRow): Promise<void> {
  await client.query(
    `UPDATE payment_links
        SET status = 'paid', paid_at = now(), transaction_id = $2, reserved_at = NULL, pending_transaction_id = NULL
      WHERE id = $1 AND status = 'reserved' AND pending_transaction_id = $2`,
    [row.id, row.pending_transaction_id],
  );
}

async function releaseLink(client: PoolClient, row: StuckLinkRow): Promise<void> {
  await client.query(
    `UPDATE payment_links
        SET status = 'active', reserved_at = NULL, pending_transaction_id = NULL
      WHERE id = $1 AND status = 'reserved' AND pending_transaction_id = $2`,
    [row.id, row.pending_transaction_id],
  );
}
