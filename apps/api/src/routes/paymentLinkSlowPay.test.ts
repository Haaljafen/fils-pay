/**
 * A payment link must be paid at most once, even when the acquirer is slower
 * than the link's reservation timeout. Uses a 1-second reservation and a
 * ~1.5-second acquirer so the race happens in seconds rather than minutes.
 * Requires DATABASE_URL (a local, migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("paymentLinkSlowPay.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "1500",
  ACQUIRER_LATENCY_MAX_MS: "1500",
  PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS: "1",
});

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function merchantWithLink(): Promise<{ merchantId: string; token: string }> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Slow Pay Merchant ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const owner = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const key = await issueApiKey(pool, config, { merchantId, createdBy: owner.rows[0]!.id, label: "slow-pay" });

  const res = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${key.rawKey}` },
    payload: { amountFils: 4_750, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { merchantId, token: (res.json() as { token: string }).token };
}

function pay(token: string) {
  return app.inject({
    method: "POST",
    url: `/v1/payment-links/${token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: CARD },
  });
}

test("a second payer arriving while a slow first payment is still in flight is not charged too", { timeout: 30_000 }, async () => {
  const { merchantId, token } = await merchantWithLink();

  const first = pay(token);
  await sleep(1_200); // past the 1s reservation timeout, before the first payment finishes
  const second = pay(token);
  const [firstRes, secondRes] = await Promise.all([first, second]);

  const captured = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM transactions WHERE merchant_id = $1 AND captured_fils > 0`,
    [merchantId],
  );
  assert.equal(
    Number(captured.rows[0]!.n),
    1,
    `one link, one charge; got ${captured.rows[0]!.n} (responses ${firstRes.statusCode}, ${secondRes.statusCode})`,
  );
  assert.deepEqual([firstRes.statusCode, secondRes.statusCode].sort(), [200, 409]);
});
