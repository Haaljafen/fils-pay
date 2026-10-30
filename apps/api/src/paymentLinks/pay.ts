import type { Pool } from "pg";
import { toFils } from "@filspay/money";
import { authorizeTransaction } from "../payments/authorize.js";
import { captureTransaction } from "../payments/capture.js";
import type { AcquirerSimulator, SimulatedCardInput } from "../acquirer/types.js";

export interface PayPaymentLinkInput {
  token: string;
  card: SimulatedCardInput;
  idempotencyKey: string;
  submittedAt?: string;
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

/** How far back a client's `submittedAt` is believed: long enough for a
 *  network retry of a pay that was pressed just before expiry, short enough
 *  that a public caller can't pay a long-expired link by sending an old
 *  timestamp. */
export const SUBMITTED_AT_GRACE_MS = 5 * 60_000;

/** A pay request is judged against when the buyer pressed pay, so a retry
 * that lands just after expiry is not penalised. `submittedAt` comes from an
 * unauthenticated client, so it is only believed within
 * SUBMITTED_AT_GRACE_MS before the server's clock; anything older, in the
 * future, or unparseable falls back to the server's time. */
export function expiryReferenceTime(submittedAt?: string, now: Date = new Date()): Date {
  if (!submittedAt) return now;
  const parsed = new Date(submittedAt);
  const ageMs = now.getTime() - parsed.getTime();
  if (Number.isNaN(ageMs) || ageMs < 0 || ageMs > SUBMITTED_AT_GRACE_MS) return now;
  return parsed;
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
  const lockClient = await pool.connect();
  let lockHeld = false;
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
      [input.token],
    );
    lockHeld = lock.rows[0]?.locked === true;
    if (!lockHeld) {
      return { statusCode: 409, body: { error: "payment_link_processing" } };
    }
    return await payWhileHoldingLinkLock(pool, acquirer, config, input);
  } finally {
    // If unlocking fails, destroy the connection instead of returning it to
    // the pool: the lock dies with the connection.
    let destroy = false;
    if (lockHeld) {
      try {
        await lockClient.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [input.token]);
      } catch {
        destroy = true;
      }
    }
    lockClient.release(destroy);
  }
}

async function payWhileHoldingLinkLock(
  pool: Pool,
  acquirer: AcquirerSimulator,
  config: { paymentLinkReservationTimeoutSeconds: number },
  input: PayPaymentLinkInput,
): Promise<PayPaymentLinkResult> {
  const expiryCheckTime = expiryReferenceTime(input.submittedAt);

  // Step 1 — claim. A single UPDATE is already atomic; no explicit
  // transaction needed.
  const claimResult = await pool.query<ClaimedLinkRow>(
    `UPDATE payment_links
        SET status = 'reserved', reserved_at = now()
      WHERE token = $1
        AND (
             status = 'active'
             OR (status = 'reserved' AND reserved_at < now() - ($2 || ' seconds')::interval)
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
  const authResult = await authorizeTransaction(pool, acquirer, {
    merchantId: link.merchantId,
    amountFils: link.amountFils,
    card: input.card,
    reference: link.reference ?? undefined,
    idempotencyKey: authorizeKey,
    // No merchant session/API key initiated this — a customer did, via
    // the public link.
    actor: { type: "system" },
  });

  if (authResult.statusCode !== 201) {
    await releaseReservation(pool, link.id);
    return {
      statusCode: authResult.statusCode,
      body: { stage: "authorize", ...(authResult.body as Record<string, unknown>) },
    };
  }

  const txnId = (authResult.body as { id: string }).id;

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
        SET status = 'paid', paid_at = now(), transaction_id = $2, reserved_at = NULL
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
  await pool.query(`UPDATE payment_links SET status = 'active', reserved_at = NULL WHERE id = $1 AND status = 'reserved'`, [
    linkId,
  ]);
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
