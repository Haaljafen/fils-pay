/**
 * The sweep settles links stuck 'reserved' with a recorded transaction (bug 90).
 * Each case sets up a stale reservation whose transaction is in a known state.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { recordKycReview } from "../onboarding/review.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { sweepStuckPaymentLinks } from "./sweep.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("sweep.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS: "60",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function approvedMerchantWithKey(label: string) {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
    `Sweep ${label} ${randomUUID()}`,
  ]);
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label });
  return { merchantId, rawKey: issued.rawKey };
}

/** A link stuck 'reserved' for an hour, with `transactionId` recorded against it. */
async function stuckLink(merchantId: string, rawKey: string, transactionId: string | null): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${rawKey}` },
    payload: { amountFils: 4750, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  const token = created.json().token as string;
  await pool.query(
    `UPDATE payment_links SET status = 'reserved', reserved_at = now() - interval '1 hour', pending_transaction_id = $2 WHERE token = $1`,
    [token, transactionId],
  );
  return token;
}

/** A real paid transaction, used as the stuck attempt's transaction. */
async function paidTransaction(merchantId: string, rawKey: string): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${rawKey}` },
    payload: { amountFils: 4750, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  const paid = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${created.json().token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: CARD },
  });
  return paid.json().transactionId as string;
}

async function setTransactionStatus(transactionId: string, status: string): Promise<void> {
  await pool.query(`UPDATE transactions SET status = $2 WHERE id = $1`, [transactionId, status]);
}

test("a stuck link whose transaction was captured is finalized as paid", async () => {
  const { merchantId, rawKey } = await approvedMerchantWithKey("captured");
  const txnId = await paidTransaction(merchantId, rawKey);
  const token = await stuckLink(merchantId, rawKey, txnId);

  const result = await sweepStuckPaymentLinks(pool, config);

  const link = await pool.query<{ status: string; transaction_id: string; pending_transaction_id: string | null }>(
    `SELECT status, transaction_id, pending_transaction_id FROM payment_links WHERE token = $1`,
    [token],
  );
  assert.equal(link.rows[0]!.status, "paid");
  assert.equal(link.rows[0]!.transaction_id, txnId);
  assert.equal(link.rows[0]!.pending_transaction_id, null);
  assert.ok(result.finalized >= 1);
});

test("a stuck link whose transaction was only authorized is released to active", async () => {
  const { merchantId, rawKey } = await approvedMerchantWithKey("authorized");
  const txnId = await paidTransaction(merchantId, rawKey);
  await setTransactionStatus(txnId, "authorized");
  const token = await stuckLink(merchantId, rawKey, txnId);

  await sweepStuckPaymentLinks(pool, config);

  const link = await pool.query<{ status: string; pending_transaction_id: string | null }>(
    `SELECT status, pending_transaction_id FROM payment_links WHERE token = $1`,
    [token],
  );
  assert.equal(link.rows[0]!.status, "active");
  assert.equal(link.rows[0]!.pending_transaction_id, null);
});

test("a stuck link whose transaction was voided is released to active", async () => {
  const { merchantId, rawKey } = await approvedMerchantWithKey("voided");
  const txnId = await paidTransaction(merchantId, rawKey);
  await setTransactionStatus(txnId, "voided");
  const token = await stuckLink(merchantId, rawKey, txnId);

  await sweepStuckPaymentLinks(pool, config);

  const link = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE token = $1`, [token]);
  assert.equal(link.rows[0]!.status, "active");
});

test("a stuck link with an unexpected transaction status is left reserved and reported", async () => {
  const { merchantId, rawKey } = await approvedMerchantWithKey("unresolved");
  const txnId = await paidTransaction(merchantId, rawKey);
  await setTransactionStatus(txnId, "partially_captured");
  const token = await stuckLink(merchantId, rawKey, txnId);

  const result = await sweepStuckPaymentLinks(pool, config);

  const link = await pool.query<{ status: string; pending_transaction_id: string | null }>(
    `SELECT status, pending_transaction_id FROM payment_links WHERE token = $1`,
    [token],
  );
  assert.equal(link.rows[0]!.status, "reserved");
  assert.equal(link.rows[0]!.pending_transaction_id, txnId);
  assert.ok(result.unresolved.some((u) => u.transactionId === txnId && u.transactionStatus === "partially_captured"));
});

test("a link held by a live attempt (advisory lock) is skipped, not settled", async () => {
  const { merchantId, rawKey } = await approvedMerchantWithKey("locked");
  const txnId = await paidTransaction(merchantId, rawKey);
  const token = await stuckLink(merchantId, rawKey, txnId);

  const holder = await pool.connect();
  try {
    await holder.query(`SELECT pg_advisory_lock(hashtextextended($1, 0))`, [token]);
    const result = await sweepStuckPaymentLinks(pool, config);
    const link = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE token = $1`, [token]);
    assert.equal(link.rows[0]!.status, "reserved");
    assert.ok(result.skipped >= 1);
  } finally {
    await holder.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [token]);
    holder.release();
  }
});
