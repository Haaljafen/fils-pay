/**
 * The fee a capture books must be the fee settlement charges for it, for
 * every capture path. Settlement (apps/settlement ComputeSettlementFee)
 * applies the negotiated discount to the amount before the MDR, as
 * ARCHITECTURE says ("discounts reduce the amount the MDR is charged on").
 * Requires DATABASE_URL (a local, migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { applyRateFils, toFils } from "@filspay/money";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("captureDiscount.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const MDR_BPS = 275;
const DISCOUNT_BPS = 75;
const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

/** Settlement's formula (ComputeSettlementFee in apps/settlement). */
function settlementFee(amountFils: number): number {
  const amount = toFils(amountFils);
  return applyRateFils(toFils(amount - applyRateFils(amount, DISCOUNT_BPS)), MDR_BPS);
}

async function discountedMerchant() {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps) VALUES ($1, $2, $3) RETURNING id`,
    [`Discount Merchant ${randomUUID()}`, MDR_BPS, DISCOUNT_BPS],
  );
  const merchantId = merchant.rows[0]!.id;
  const owner = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const key = await issueApiKey(pool, config, { merchantId, createdBy: owner.rows[0]!.id, label: "discount" });
  return { merchantId, auth: { authorization: `Bearer ${key.rawKey}` } };
}

async function netFeeBooked(transactionId: string): Promise<number> {
  const result = await pool.query<{ net: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)::text AS net
       FROM ledger_entries WHERE transaction_id = $1 AND account_id = 'platform_fee_revenue'`,
    [transactionId],
  );
  return Number(result.rows[0]!.net);
}

test("API capture books the same discounted fee settlement will charge", async () => {
  const { auth } = await discountedMerchant();
  const authRes = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: { amountFils: 1000, card: CARD, reference: "discount-api" },
  });
  assert.equal(authRes.statusCode, 201, authRes.body);
  const txnId = (authRes.json() as { id: string }).id;

  const capRes = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txnId}/capture`,
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(capRes.statusCode, 200, capRes.body);
  assert.equal(await netFeeBooked(txnId), settlementFee(1000));
});

test("a payment-link capture gets the merchant's negotiated discount too", async () => {
  const { merchantId, auth } = await discountedMerchant();
  const linkRes = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: auth,
    payload: { amountFils: 40_000, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(linkRes.statusCode, 201, linkRes.body);
  const token = (linkRes.json() as { token: string }).token;

  const payRes = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: CARD },
  });
  assert.equal(payRes.statusCode, 200, payRes.body);
  const txnId = (payRes.json() as { transactionId: string }).transactionId;
  assert.equal(await netFeeBooked(txnId), settlementFee(40_000));
});
