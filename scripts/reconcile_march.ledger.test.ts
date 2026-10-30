/**
 * The residue posting against a real database, inside a transaction that is
 * always rolled back. Requires DATABASE_URL (a local, migrated Postgres).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { postResidueCorrection } from "./reconcile_march.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reconcile_march.ledger.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

async function inRolledBackTransaction(fn: (client: Client, merchantId: string) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const merchant = await client.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ('reconcile-march-test', 250) RETURNING id`,
    );
    await fn(client, merchant.rows[0]!.id);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

async function legs(client: Client, merchantId: string) {
  const result = await client.query<{ account_id: string; direction: string; amount_fils: string }>(
    `SELECT account_id, direction, amount_fils FROM ledger_entries WHERE merchant_id = $1 ORDER BY account_id`,
    [merchantId],
  );
  return result.rows.map((r) => [r.account_id, r.direction, Number(r.amount_fils)]);
}

test("the residue moves from card_scheme_clearing to the suspense account (ADR-0002), not from the merchant", async () => {
  await inRolledBackTransaction(async (client, merchantId) => {
    await postResidueCorrection(client, { merchantId, lineCount: 2, residueFils: 16 }, new Date());
    assert.deepEqual(await legs(client, merchantId), [
      ["card_scheme_clearing", "credit", 16],
      ["scheme_rounding_residue", "debit", 16],
    ]);
  });
});

test("running the sweep again posts nothing new", async () => {
  await inRolledBackTransaction(async (client, merchantId) => {
    const merchant = { merchantId, lineCount: 2, residueFils: 16 };
    await postResidueCorrection(client, merchant, new Date());
    await postResidueCorrection(client, merchant, new Date());
    assert.equal((await legs(client, merchantId)).length, 2, "a re-run must not post a second correction");
  });
});
