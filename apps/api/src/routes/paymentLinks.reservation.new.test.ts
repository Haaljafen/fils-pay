/**
 * A pay that fails with an unexpected error (the acquirer throws) must give
 * the reservation back, so the link is payable again at once instead of
 * sitting 'reserved' for the whole reservation timeout.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { recordKycReview } from "../onboarding/review.js";
import { issueApiKey } from "../apiKeys/issue.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("paymentLinks.reservation.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
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
    `Reservation ${label} ${randomUUID()}`,
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

// A reservation older than the timeout whose attempt already recorded a
// transaction means money may have moved (capture succeeded, then the final
// write failed). It must not be reclaimed and charged a second time.
test("a stale reservation that already has a transaction is never reclaimed and charged again", async () => {
  const { merchantId, rawKey } = await approvedMerchantWithKey("stale-with-txn");
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${rawKey}` },
    payload: { amountFils: 4750, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  const token = created.json().token as string;
  // A real transaction, from a separate paid link, stands in for the in-flight one.
  const other = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${rawKey}` },
    payload: { amountFils: 4750, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  const paid = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${other.json().token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: CARD },
  });
  const txnId = paid.json().transactionId as string;
  await pool.query(
    `UPDATE payment_links SET status = 'reserved', reserved_at = now() - interval '1 hour', pending_transaction_id = $2 WHERE token = $1`,
    [token, txnId],
  );

  const res = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: CARD },
  });
  assert.notEqual(res.statusCode, 200, "a link with a recorded transaction must not be paid again");
  const link = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE token = $1`, [token]);
  assert.equal(link.rows[0]!.status, "reserved");
});

test("an unexpected error during authorize releases the reservation so the link is payable again", async () => {
  const { merchantId, rawKey } = await approvedMerchantWithKey("authorize-throws");
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${rawKey}` },
    payload: { amountFils: 4750, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(created.statusCode, 201, created.body);
  const token = created.json().token as string;

  // Swap in an acquirer that fails unexpectedly on authorize.
  const realAcquirer = app.acquirer;
  (app as unknown as { acquirer: unknown }).acquirer = {
    ...realAcquirer,
    authorize: async () => {
      throw new Error("acquirer connection reset");
    },
  };
  try {
    const failed = await app.inject({
      method: "POST",
      url: `/v1/payment-links/${token}/pay`,
      headers: { "idempotency-key": randomUUID() },
      payload: { card: CARD },
    });
    assert.ok(failed.statusCode >= 500, `expected a server error, got ${failed.statusCode}`);
  } finally {
    (app as unknown as { acquirer: unknown }).acquirer = realAcquirer;
  }

  const after = await app.inject({ method: "GET", url: `/v1/payment-links/${token}` });
  assert.equal(after.json().status, "active", `link should be active again, was ${after.json().status}`);
});
