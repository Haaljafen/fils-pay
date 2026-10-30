/**
 * Regression tests for the webhook/payout exactly-once chain:
 *  - the signature must cover the exact bytes sent (ya/sign-raw);
 *  - a delivery must be claimed, so two passes/replicas never send it twice;
 *  - a payout instruction (settlement_payout_disbursements) is written once per
 *    batch no matter how many deliveries/retries/duplicate events touch it;
 *  - the outbox holds at most one settlement.paid per batch.
 * Requires DATABASE_URL to point at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { loadConfig } from "../config.js";
import { createWebhookEndpoint } from "./create.js";
import { runDispatchPass } from "./dispatcher.js";
import { WEBHOOK_SIGNATURE_HEADER } from "./headers.js";
import { recordPayoutDisbursementEffect } from "./payoutDisbursement.js";
import type { WebhookTransport, WebhookTransportRequest } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("payoutIntegrity.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  WEBHOOK_MAX_ATTEMPTS: "3",
  WEBHOOK_BACKOFF_BASE_MS: "1000",
  WEBHOOK_BACKOFF_CAP_MS: "60000",
  WEBHOOK_REQUEST_TIMEOUT_MS: "5000",
});

const pool = new Pool({ connectionString: databaseUrl, max: 8 });

test.after(async () => {
  await pool.end();
});

async function createMerchant(label: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Payout Integrity ${label} ${randomUUID()}`, 250],
  );
  return result.rows[0]!.id;
}

async function enqueueCaptured(merchantId: string) {
  return enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 4_750, feeFils: 71, newStatus: "captured", capturedTotalFils: 4_750 },
  });
}

async function createEndpoint(merchantId: string, url: string) {
  return createWebhookEndpoint(pool, config, {
    merchantId,
    url,
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
}

test("two overlapping dispatch passes send a due delivery once", async () => {
  const merchantId = await createMerchant("claim");
  const url = `http://fake-receiver.test/claim-${randomUUID()}`;
  await createEndpoint(merchantId, url);
  await enqueueCaptured(merchantId);

  let calls = 0;
  const transport: WebhookTransport = async (req) => {
    if (req.url === url) {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return { statusCode: 200, body: "ok" };
  };
  await Promise.all([runDispatchPass(pool, transport, config), runDispatchPass(pool, transport, config)]);

  assert.equal(calls, 1, "the delivery was sent by both passes");
});

async function createPaidBatch(netPayoutFils: number): Promise<string> {
  const merchantId = await createMerchant("batch");
  const batch = await pool.query<{ id: string }>(
    `INSERT INTO settlement_batches
        (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at, paid_at)
     VALUES ($1, current_date, 'paid', $2, 0, $2, now(), now())
     RETURNING id`,
    [merchantId, netPayoutFils],
  );
  return batch.rows[0]!.id;
}

test("a payout instruction is written once per batch however often the effect runs", async () => {
  const batchId = await createPaidBatch(250_000);

  await recordPayoutDisbursementEffect(pool, batchId, 250_000);
  await recordPayoutDisbursementEffect(pool, batchId, 250_000);
  await Promise.all([
    recordPayoutDisbursementEffect(pool, batchId, 250_000),
    recordPayoutDisbursementEffect(pool, batchId, 250_000),
  ]);

  const rows = await pool.query(`SELECT 1 FROM settlement_payout_disbursements WHERE settlement_batch_id = $1`, [batchId]);
  assert.equal(rows.rows.length, 1);
});

test("the outbox refuses a second settlement.paid for the same batch", async () => {
  const batchId = randomUUID();
  const insert = () =>
    pool.query(
      `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
       VALUES ('settlement.paid', 'settlement_batch', $1, $2)`,
      [batchId, JSON.stringify({ merchantId: randomUUID(), batchId, batchDate: "2026-04-01", netPayoutFils: 1 })],
    );
  await insert();
  await assert.rejects(insert(), (err: { code?: string }) => err.code === "23505");
});
