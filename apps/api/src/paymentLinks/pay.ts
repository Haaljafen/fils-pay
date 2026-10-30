import type { Pool, PoolClient } from "pg";
import { toFils } from "@filspay/money";
import { authorizeTransaction } from "../payments/authorize.js";
import { captureTransaction } from "../payments/capture.js";
import type { AcquirerSimulator, SimulatedCardInput } from "../acquirer/types.js";

export interface PayPaymentLinkInput {
  token: string;
  card: SimulatedCardInput;
  idempotencyKey: string;
}

export interface PayPaymentLinkResult {
  statusCode: number;
  body: unknown;
}

/** Returned by the claim UPDATE; merchant_id comes from the link row, never from the request. */
interface ClaimedLinkRow {
  id: string;
  merchant_id: string;
  amount_fils: string | number;
  reference: string | null;
}

interface LinkStatusRow {
  status: string;
  expires_at: Date;
}

/**
 * `POST /v1/payment-links/:token/pay` business logic (public,
 * unauthenticated). Calls `authorizeTransaction`
 * then `captureTransaction` directly, in sequence, never issuing an HTTP
 * request back into the API's own /v1/transactions routes.
 *
 * Concurrency: reserve the link with a single
 * atomic conditional UPDATE, release the row lock immediately, run
 * authorize+capture with no lock held on payment_links at all, then
 * finalize with a second atomic conditional UPDATE keyed on still being in
 * the 'reserved' state. A short, configurable reservation timeout
 * self-heals a link stuck 'reserved' by a crash between claim and
 * finalize, with no sweep job.
 */
export async function payPaymentLink(
  pool: Pool,
  acquirer: AcquirerSimulator,
  config: { paymentLinkReservationTimeoutSeconds: number },
  input: PayPaymentLinkInput,
): Promise<PayPaymentLinkResult> {
  // One pay attempt per link at a time, for as long as the attempt runs. The
  // time-based reservation alone let a second payer re-claim the link once
  // reserved_at was older than the timeout while the first attempt was still
  // waiting on the acquirer, and both were charged (incident 2026-05-14:
  // captures "60–70 s apart" against a 60 s timeout). A session advisory lock
  // has no timeout to outrun, and Postgres releases it if this process dies,
  // so a crashed attempt still frees the link.
  //
  // Every query of the attempt then runs on this SAME connection. Borrowing a
  // second pooled connection for each step while this one sat holding the lock
  // needed two at once per checkout: with the pool at its default of 5, five
  // concurrent checkouts took every connection for their locks, none could get
  // one to authorize, and all of them failed with a 500 when the pool's
  // connection timeout ran out.
  const lockClient = await pool.connect();
  let lockHeld = false;
  let connectionBroken = false;
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
      [input.token],
    );
    lockHeld = lock.rows[0]?.locked === true;
    if (!lockHeld) {
      return { statusCode: 409, body: { error: "payment_link_processing" } };
    }
    const onePool = singleConnectionPool(lockClient, () => {
      connectionBroken = true;
    });
    return await payWhileHoldingLinkLock(onePool, acquirer, config, input);
  } finally {
    // If unlocking fails, or a step left the connection in an unknown state,
    // destroy it instead of returning it to the pool: the lock dies with the
    // connection.
    let destroy = connectionBroken;
    if (lockHeld && !destroy) {
      try {
        await lockClient.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [input.token]);
      } catch {
        destroy = true;
      }
    }
    lockClient.release(destroy);
  }
}

/**
 * A Pool stand-in that always hands out `client`, so authorizeTransaction and
 * captureTransaction (which take a Pool and open their own withTransaction)
 * run on the connection already holding the link's advisory lock. Their
 * transactions are sequential, never nested, so sharing one session is safe,
 * and a session-level advisory lock survives each COMMIT/ROLLBACK.
 * withTransaction's release() is a no-op here (the caller owns the client);
 * a release(err) after a failed ROLLBACK is reported through `onBroken` so
 * the caller destroys the connection instead of pooling it.
 */
function singleConnectionPool(client: PoolClient, onBroken: () => void): Pool {
  const lent = new Proxy(client, {
    get(target, prop) {
      if (prop === "release") {
        return (err?: Error | boolean) => {
          if (err) onBroken();
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    connect: async () => lent,
    query: (...args: Parameters<PoolClient["query"]>) => client.query(...args),
  } as unknown as Pool;
}

async function payWhileHoldingLinkLock(
  pool: Pool,
  acquirer: AcquirerSimulator,
  config: { paymentLinkReservationTimeoutSeconds: number },
  input: PayPaymentLinkInput,
): Promise<PayPaymentLinkResult> {
  // The server's clock decides expiry. A client-supplied time would let a
  // buyer extend a link's life (FP-187).
  const expiryCheckTime = new Date();

  // Step 1 — claim. A single UPDATE is already atomic; no explicit
  // transaction needed.
  const claimResult = await pool.query<ClaimedLinkRow>(
    `UPDATE payment_links
        SET status = 'reserved', reserved_at = now()
      WHERE token = $1
        AND (
             status = 'active'
             -- A stale reservation is reclaimable only if no transaction was recorded
             -- against it. A recorded one may already have captured money, and a
             -- second charge on the same link is the worst outcome (bug 90).
             OR (status = 'reserved' AND pending_transaction_id IS NULL
                 AND reserved_at < now() - ($2 || ' seconds')::interval)
            )
        AND expires_at > $3
      RETURNING id, merchant_id, amount_fils, reference`,
    [input.token, config.paymentLinkReservationTimeoutSeconds, expiryCheckTime],
  );

  const claimedRow = claimResult.rows[0];
  if (!claimedRow) {
    return classifyClaimFailure(pool, input.token, config.paymentLinkReservationTimeoutSeconds, expiryCheckTime);
  }

  const link = {
    id: claimedRow.id,
    merchantId: claimedRow.merchant_id,
    amountFils: toFils(Number(claimedRow.amount_fils)),
    reference: claimedRow.reference,
  };

  // Step 2 — authorize.
  // am: keys include link.id so two links can never collide on idempotency. good
  const authorizeKey = `paylink:${link.id}:${input.idempotencyKey}:authorize`;
  // An unexpected throw (not a declined or failed result) must not leave the
  // link 'reserved' for the whole reservation timeout: release it, then rethrow.
  const authResult = await authorizeTransaction(pool, acquirer, {
    merchantId: link.merchantId,
    amountFils: link.amountFils,
    card: input.card,
    reference: link.reference ?? undefined,
    idempotencyKey: authorizeKey,
    // No merchant session/API key initiated this — a customer did, via
    // the public link.
    actor: { type: "system" },
  }).catch(async (err: unknown) => {
    await releaseReservation(pool, link.id);
    throw err;
  });

  if (authResult.statusCode !== 201) {
    await releaseReservation(pool, link.id);
    return {
      statusCode: authResult.statusCode,
      body: { stage: "authorize", ...(authResult.body as Record<string, unknown>) },
    };
  }

  const txnId = (authResult.body as { id: string }).id;

  // Record the attempt's transaction on the link while it is still reserved.
  // From here on a crash or failed write cannot make the link payable again
  // while the attempt's money may have moved (bug 90).
  await pool.query(`UPDATE payment_links SET pending_transaction_id = $2 WHERE id = $1 AND status = 'reserved'`, [link.id, txnId]);

  // NOTE: discountAdjustment is applied by the transactions route only, not here — FH
  // MK: it's applied for both now (moved into capture.ts in July)
  // Step 3 — capture (full amount, immediately). amountFils omitted =>
  // capture the full remaining amount — always correct here, since this
  // transaction was just authorized for exactly link.amountFils and
  // nothing else could have touched it yet.
  const captureKey = `paylink:${link.id}:${input.idempotencyKey}:capture`;
  const captureResult = await captureTransaction(pool, acquirer, {
    transactionId: txnId,
    merchantId: link.merchantId,
    idempotencyKey: captureKey,
    actor: { type: "system", id: link.id },
  }).catch(async (err: unknown) => {
    await releaseReservation(pool, link.id);
    throw err;
  });

  if (captureResult.statusCode !== 200) {
    await releaseReservation(pool, link.id);
    return {
      statusCode: captureResult.statusCode,
      body: { stage: "capture", ...(captureResult.body as Record<string, unknown>) },
    };
  }

  // Incident 2026-05-14 (two customers charged on one link) was a second payer
  // re-claiming after the reservation timeout; the advisory lock in
  // payPaymentLink now makes that impossible.
  // Step 4 — finalize.
  const finalizeResult = await pool.query<{
    id: string;
    paid_at: Date;
  }>(
    `UPDATE payment_links
        SET status = 'paid', paid_at = now(), transaction_id = $2, reserved_at = NULL, pending_transaction_id = NULL
      WHERE id = $1 AND status = 'reserved'
      RETURNING id, paid_at`,
    [link.id, txnId],
  );

  const finalized = finalizeResult.rows[0];
  if (!finalized) {
    // Unreachable while payPaymentLink holds the link's advisory lock: no
    // other attempt can re-claim the link in between. The acquirer-side capture genuinely
    // succeeded and money moved; failing to *record* that fact against the
    // link is a data-consistency bug to surface loudly, not a reason to
    // tell a customer whose card was actually charged that their payment
    // failed.
    console.error(
      `payPaymentLink: finalize UPDATE matched 0 rows for link ${link.id} after a successful capture ` +
        `(transaction ${txnId}) — invariant violation, investigate`,
    );
    return {
      statusCode: 200,
      body: { status: "paid", transactionId: txnId, amountFils: link.amountFils, paidAt: new Date().toISOString() },
    };
  }

  return {
    statusCode: 200,
    body: {
      status: "paid",
      transactionId: txnId,
      amountFils: link.amountFils,
      paidAt: finalized.paid_at.toISOString(),
    },
  };
}

/**
 * Used by both decline branches above. Guarded by `status =
 * 'reserved'` for the same reason as the finalize UPDATE: this request
 * only ever releases the reservation it itself holds.
 */
async function releaseReservation(pool: Pool, linkId: string): Promise<void> {
  await pool.query(
    `UPDATE payment_links SET status = 'active', reserved_at = NULL, pending_transaction_id = NULL WHERE id = $1 AND status = 'reserved'`,
    [linkId],
  );
}

/**
 * The claim UPDATE matched 0 rows. This second read carries no race risk —
 * nothing further is decided from it, it only explains a decision already
 * made by the failed UPDATE.
 */
async function classifyClaimFailure(
  pool: Pool,
  token: string,
  reservationTimeoutSeconds: number,
  expiryCheckTime: Date,
): Promise<PayPaymentLinkResult> {
  const result = await pool.query<LinkStatusRow>(`SELECT status, expires_at FROM payment_links WHERE token = $1`, [
    token,
  ]);
  const row = result.rows[0];

  if (!row) {
    return { statusCode: 404, body: { error: "payment_link_not_found" } };
  }
  if (row.status === "paid") {
    return { statusCode: 409, body: { error: "payment_link_already_paid" } };
  }
  if (row.status === "canceled") {
    return { statusCode: 409, body: { error: "payment_link_canceled" } };
  }
  if (row.status === "active" && row.expires_at.getTime() <= expiryCheckTime.getTime()) {
    return { statusCode: 410, body: { error: "payment_link_expired" } };
  }
  if (row.status === "reserved") {
    // A concurrent claim attempt raced us and won between our own UPDATE's
    // failure and this SELECT. It's still within the timeout (if it
    // weren't, our claim UPDATE would have matched it) — reachable only in
    // a genuine race, not a stale read.
    return { statusCode: 409, body: { error: "payment_link_processing" } };
  }
  // Defensive fallback, should be unreachable given the claim UPDATE's
  // WHERE clause exactly mirrors these cases.
  return { statusCode: 409, body: { error: "payment_link_not_payable", status: row.status } };
}
