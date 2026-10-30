/**
 * Route-level tests for the transactions surface — authorize, capture,
 * void, and reads — using `app.inject(...)` against `buildApp()` and a
 * real, migrated Postgres (no DB mocking). Requires `DATABASE_URL` (run
 * `npm run migrate` first).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "transactions.test.ts requires DATABASE_URL to point at a real, migrated Postgres (run `npm run migrate` first)",
  );
}

// Deterministic, fast, always-approved acquirer for these tests: failure
// rate 0 and near-zero latency. Card-declined/error paths are exercised via
// the acquirer simulator's own magic PANs where a test needs them.
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const VALID_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

/** Inserts a merchant directly (bypassing the full signup flow, which this
 *  file doesn't need) and approves it through the real recordKycReview()
 *  write path, then issues a real API key for it. */
async function createApprovedMerchantWithApiKey(label: string, mdrBps = 250) {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Test Merchant ${label} ${randomUUID()}`, mdrBps],
  );
  const merchantId = merchantResult.rows[0]!.id;

  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused-in-these-tests')
     RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  const ownerUserId = userResult.rows[0]!.id;

  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: ownerUserId, label });

  return { merchantId, ownerUserId, rawKey: issued.rawKey };
}

function authHeader(rawKey: string) {
  return { authorization: `Bearer ${rawKey}` };
}

async function authorize(rawKey: string, amountFils: number, opts: { idempotencyKey?: string; reference?: string } = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...authHeader(rawKey), "idempotency-key": opts.idempotencyKey ?? randomUUID() },
    payload: { amountFils, card: VALID_CARD, reference: opts.reference ?? "order-1" },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { id: string; status: string; amountFils: number; capturedFils: number };
}

async function capture(
  rawKey: string,
  transactionId: string,
  body: { amountFils?: number } = {},
  idempotencyKey: string = randomUUID(),
) {
  return app.inject({
    method: "POST",
    url: `/v1/transactions/${transactionId}/capture`,
    headers: { ...authHeader(rawKey), "idempotency-key": idempotencyKey },
    payload: body,
  });
}

test("authorize -> capture (full) happy path posts correct, balanced ledger legs", async () => {
  const { rawKey } = await createApprovedMerchantWithApiKey("full-capture", 250);
  const txn = await authorize(rawKey, 10_000);
  assert.equal(txn.status, "authorized");
  assert.equal(txn.amountFils, 10_000);
  assert.equal(txn.capturedFils, 0);

  const preLedger = await pool.query(`SELECT COUNT(*)::int AS c FROM ledger_entries WHERE transaction_id = $1`, [
    txn.id,
  ]);
  assert.equal(preLedger.rows[0]!.c, 0);

  const captureRes = await capture(rawKey, txn.id);
  assert.equal(captureRes.statusCode, 200, captureRes.body);
  const captureBody = captureRes.json();
  assert.equal(captureBody.status, "captured");
  assert.equal(captureBody.capturedFils, 10_000);

  // 2.50% MDR on 10,000 fils = 250 fils fee (bankers rounding, exact here).
  const legs = await pool.query<{ account_id: string; direction: string; amount_fils: string }>(
    `SELECT account_id, direction, amount_fils FROM ledger_entries WHERE transaction_id = $1`,
    [txn.id],
  );
  assert.equal(legs.rows.length, 4);
  const byLeg = new Map(legs.rows.map((r) => [`${r.account_id}:${r.direction}`, Number(r.amount_fils)]));
  assert.equal(byLeg.get("card_scheme_clearing:debit"), 10_000);
  assert.equal(byLeg.get("merchant_payable:credit"), 10_000);
  assert.equal(byLeg.get("merchant_payable:debit"), 250);
  assert.equal(byLeg.get("platform_fee_revenue:credit"), 250);

  const groupIds = new Set(
    (await pool.query<{ entry_group_id: string }>(`SELECT DISTINCT entry_group_id FROM ledger_entries WHERE transaction_id = $1`, [txn.id]))
      .rows.map((r) => r.entry_group_id),
  );
  assert.equal(groupIds.size, 1, "all four legs share one entry_group_id");

  const hold = await pool.query<{ status: string }>(`SELECT status FROM holds WHERE transaction_id = $1`, [txn.id]);
  assert.equal(hold.rows[0]!.status, "released");
});

test("authorize -> capture (partial) -> capture (remainder) transitions status correctly", async () => {
  const { rawKey } = await createApprovedMerchantWithApiKey("partial-capture");
  const txn = await authorize(rawKey, 10_000);

  const partialRes = await capture(rawKey, txn.id, { amountFils: 4_000 });
  assert.equal(partialRes.statusCode, 200, partialRes.body);
  const partialBody = partialRes.json();
  assert.equal(partialBody.status, "partially_captured");
  assert.equal(partialBody.capturedFils, 4_000);

  const holdMid = await pool.query<{ status: string }>(`SELECT status FROM holds WHERE transaction_id = $1`, [txn.id]);
  assert.equal(holdMid.rows[0]!.status, "active");

  const remainderRes = await capture(rawKey, txn.id);
  assert.equal(remainderRes.statusCode, 200, remainderRes.body);
  const remainderBody = remainderRes.json();
  assert.equal(remainderBody.status, "captured");
  assert.equal(remainderBody.capturedFils, 10_000);

  const holdEnd = await pool.query<{ status: string }>(`SELECT status FROM holds WHERE transaction_id = $1`, [txn.id]);
  assert.equal(holdEnd.rows[0]!.status, "released");
});

test("authorize -> void happy path releases the hold and transitions to voided", async () => {
  const { rawKey } = await createApprovedMerchantWithApiKey("void-happy");
  const txn = await authorize(rawKey, 5_000);

  const voidRes = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txn.id}/void`,
    headers: authHeader(rawKey),
  });
  assert.equal(voidRes.statusCode, 200, voidRes.body);
  assert.equal(voidRes.json().status, "voided");

  const hold = await pool.query<{ status: string }>(`SELECT status FROM holds WHERE transaction_id = $1`, [txn.id]);
  assert.equal(hold.rows[0]!.status, "released");
});

/** A logged-in (OTP-verified) dashboard user of `role` at `merchantId`, as the
 *  cookie header their browser would send. */
async function sessionCookieFor(merchantId: string, role: "owner" | "finance" | "support"): Promise<string> {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, $3, 'unused-in-these-tests') RETURNING id`,
    [merchantId, `${role}-${randomUUID()}@example.test`, role],
  );
  const rawToken = randomToken(32);
  await pool.query(
    `INSERT INTO sessions (merchant_user_id, token_hash, authenticated, expires_at)
     VALUES ($1, $2, true, now() + interval '1 hour')`,
    [user.rows[0]!.id, sha256Hex(rawToken)],
  );
  return `${config.cookieName}=${rawToken}`;
}

test("a support dashboard user cannot capture or void; the transaction is untouched", async () => {
  const { merchantId, rawKey } = await createApprovedMerchantWithApiKey("support-no-money");
  const txn = await authorize(rawKey, 5_000);
  const supportCookie = await sessionCookieFor(merchantId, "support");

  for (const action of ["capture", "void"]) {
    const res = await app.inject({
      method: "POST",
      url: `/v1/transactions/${txn.id}/${action}`,
      headers: { cookie: supportCookie, "idempotency-key": randomUUID() },
      payload: {},
    });
    assert.equal(res.statusCode, 403, `${action}: ${res.body}`);
  }

  const row = await pool.query<{ status: string }>(`SELECT status FROM transactions WHERE id = $1`, [txn.id]);
  assert.equal(row.rows[0]!.status, "authorized");
});

test("a finance dashboard user can still void", async () => {
  const { merchantId, rawKey } = await createApprovedMerchantWithApiKey("finance-void");
  const txn = await authorize(rawKey, 5_000);

  const res = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txn.id}/void`,
    headers: { cookie: await sessionCookieFor(merchantId, "finance") },
  });
  assert.equal(res.statusCode, 200, res.body);
});

test("void on an already-captured transaction is rejected 409", async () => {
  const { rawKey } = await createApprovedMerchantWithApiKey("void-after-capture");
  const txn = await authorize(rawKey, 3_000);
  const captureRes = await capture(rawKey, txn.id);
  assert.equal(captureRes.statusCode, 200, captureRes.body);

  const voidRes = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txn.id}/void`,
    headers: authHeader(rawKey),
  });
  assert.equal(voidRes.statusCode, 409, voidRes.body);
  assert.equal(voidRes.json().error, "not_voidable");
});

test("capture with a reused idempotency key and identical body replays without a second ledger entry", async () => {
  const { rawKey } = await createApprovedMerchantWithApiKey("idempotent-replay");
  const txn = await authorize(rawKey, 8_000);
  const key = randomUUID();

  const first = await capture(rawKey, txn.id, {}, key);
  assert.equal(first.statusCode, 200, first.body);

  const countAfterFirst = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM ledger_entries WHERE transaction_id = $1`,
    [txn.id],
  );

  const second = await capture(rawKey, txn.id, {}, key);
  assert.equal(second.statusCode, 200, second.body);
  assert.deepEqual(second.json(), first.json());

  const countAfterSecond = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM ledger_entries WHERE transaction_id = $1`,
    [txn.id],
  );
  assert.equal(Number(countAfterSecond.rows[0]!.c), Number(countAfterFirst.rows[0]!.c));
  assert.ok(Number(countAfterFirst.rows[0]!.c) > 0);
});

// FH: should also cover same key + same body on a DIFFERENT transaction -> 422 (API.md). Claude says
// that case can't happen because keys are per transaction
test("capture with a reused idempotency key but a different body is rejected as a conflict", async () => {
  const { rawKey } = await createApprovedMerchantWithApiKey("idempotent-conflict");
  const txn = await authorize(rawKey, 8_000);
  const key = randomUUID();

  const first = await capture(rawKey, txn.id, { amountFils: 1_000 }, key);
  assert.equal(first.statusCode, 200, first.body);

  const conflicting = await capture(rawKey, txn.id, { amountFils: 2_000 }, key);
  assert.equal(conflicting.statusCode, 422, conflicting.body);
  assert.equal(conflicting.json().error, "idempotency_key_reused");
});

/** Covers GET detail/events and capture. Refunds are not routed yet, so cross-tenant refund is not covered. */
test("cross-tenant transaction access (wrong merchant) returns 404, not 403 or 500", async () => {
  const owner = await createApprovedMerchantWithApiKey("cross-tenant-owner");
  const intruder = await createApprovedMerchantWithApiKey("cross-tenant-intruder");
  const txn = await authorize(owner.rawKey, 5_000);

  const getRes = await app.inject({
    method: "GET",
    url: `/v1/transactions/${txn.id}`,
    headers: authHeader(intruder.rawKey),
  });
  assert.equal(getRes.statusCode, 404, getRes.body);

  const captureRes = await capture(intruder.rawKey, txn.id);
  assert.equal(captureRes.statusCode, 404, captureRes.body);
  assert.equal(captureRes.json().error, "transaction_not_found");

  const voidRes = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txn.id}/void`,
    headers: authHeader(intruder.rawKey),
  });
  assert.equal(voidRes.statusCode, 404, voidRes.body);
});

test("capture amount exceeding remaining is rejected 422", async () => {
  const { rawKey } = await createApprovedMerchantWithApiKey("capture-exceeds");
  const txn = await authorize(rawKey, 5_000);

  const res = await capture(rawKey, txn.id, { amountFils: 5_001 });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error, "capture_exceeds_remaining");
  assert.equal(res.json().remainingFils, 5_000);
});

test("GET /v1/transactions/:id/events returns the timeline in chronological order", async () => {
  const { rawKey } = await createApprovedMerchantWithApiKey("events-timeline");
  const txn = await authorize(rawKey, 6_000);
  await capture(rawKey, txn.id, { amountFils: 2_000 });
  await capture(rawKey, txn.id);

  const res = await app.inject({
    method: "GET",
    url: `/v1/transactions/${txn.id}/events`,
    headers: authHeader(rawKey),
  });
  assert.equal(res.statusCode, 200, res.body);
  const events = res.json() as Array<{ eventType: string; amountFils: number | null }>;
  assert.deepEqual(
    events.map((e) => e.eventType),
    ["authorized", "partially_captured", "captured"],
  );
  assert.equal(events[1]!.amountFils, 2_000);
  assert.equal(events[2]!.amountFils, 4_000);
});

// delete/replace this when FP-212 lands — am
// MK: keep it until the route is behind the feature flag (REFUNDS_V2), then flip the assertion
function refundRequest(merchantId: string, headers: Record<string, string>, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/refunds`,
    headers: { "idempotency-key": randomUUID(), ...headers },
    payload,
  });
}

test("refunds over HTTP: partial then the rest, timeline and status follow", async () => {
  const { merchantId, rawKey } = await createApprovedMerchantWithApiKey("refund-http");
  const txn = await authorize(rawKey, 10_000);
  assert.equal((await capture(rawKey, txn.id)).statusCode, 200);

  const partial = await refundRequest(merchantId, authHeader(rawKey), { transactionId: txn.id, amountFils: 4_000, reason: "damaged item" });
  assert.equal(partial.statusCode, 200, partial.body);
  assert.equal(partial.json().transactionStatus, "partially_refunded");

  const rest = await refundRequest(merchantId, authHeader(rawKey), { transactionId: txn.id });
  assert.equal(rest.statusCode, 200, rest.body);
  assert.equal(rest.json().amountFils, 6_000);
  assert.equal(rest.json().transactionStatus, "refunded");

  const timeline = await app.inject({ method: "GET", url: `/v1/transactions/${txn.id}/events`, headers: authHeader(rawKey) });
  const events = timeline.json() as Array<{ eventType: string; amountFils: number | null }>;
  assert.deepEqual(events.slice(-2).map((e) => [e.eventType, e.amountFils]), [["refund_partial", -4_000], ["refunded", -6_000]]);
});

test("refunds: a support user is refused, another merchant's path is refused, the key is required", async () => {
  const { merchantId, rawKey } = await createApprovedMerchantWithApiKey("refund-guards");
  const txn = await authorize(rawKey, 5_000);
  assert.equal((await capture(rawKey, txn.id)).statusCode, 200);

  const support = await refundRequest(merchantId, { cookie: await sessionCookieFor(merchantId, "support") }, { transactionId: txn.id });
  assert.equal(support.statusCode, 403, support.body);

  const other = await createApprovedMerchantWithApiKey("refund-guards-other");
  const crossPath = await refundRequest(other.merchantId, authHeader(rawKey), { transactionId: txn.id });
  assert.equal(crossPath.statusCode, 403, crossPath.body);

  const noKey = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/refunds`,
    headers: authHeader(rawKey),
    payload: { transactionId: txn.id },
  });
  assert.equal(noKey.statusCode, 400, noKey.body);
});
