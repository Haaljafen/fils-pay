/**
 * A delivery whose endpoint secret cannot be decrypted can never succeed.
 * It must be parked as 'exhausted' instead of being claimed and retried on
 * every pass (which logged an error and held a lease each time, forever).
 * Requires DATABASE_URL pointing at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { loadConfig } from "../config.js";
import { createWebhookEndpoint } from "./create.js";
import { runDispatchPass } from "./dispatcher.js";
import type { WebhookTransport, WebhookTransportRequest } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("dispatcher.undecryptable.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
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

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
test.after(async () => {
  await pool.end();
});

test("a delivery whose secret cannot be decrypted is parked as exhausted and never sent or retried", async () => {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Undecryptable Secret ${randomUUID()}`],
  );
  const merchantId = merchantResult.rows[0]!.id;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url: "https://receiver.example.test/hook",
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  // Corrupt the stored secret: it no longer decrypts under the configured key.
  await pool.query(`UPDATE webhook_endpoints SET secret_ciphertext = 'corrupted-not-a-ciphertext' WHERE id = $1`, [
    endpoint.id,
  ]);
  await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 4_750, feeFils: 71, newStatus: "captured", capturedTotalFils: 4_750 },
  });

  // Other tests leave due deliveries in the shared database, so count only
  // what was sent to this test's endpoint.
  const sent: WebhookTransportRequest[] = [];
  const transport: WebhookTransport = async (req) => {
    if (req.url === "https://receiver.example.test/hook") sent.push(req);
    return { statusCode: 200, body: "" };
  };

  await runDispatchPass(pool, transport, config);
  await runDispatchPass(pool, transport, config);

  const rows = await pool.query<{ status: string }>(`SELECT status FROM webhook_deliveries WHERE endpoint_id = $1`, [
    endpoint.id,
  ]);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0]!.status, "exhausted");
  assert.equal(sent.length, 0, "nothing can be signed or sent without the secret");
});
