import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { resolveReportMerchantId } from "./scope.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
test.after(async () => { await pool.end(); });

async function merchant(): Promise<string> {
  const r = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [`scope ${randomUUID()}`]);
  return r.rows[0]!.id;
}

test("a merchant may report on its own split child but not on someone else's", async () => {
  const [parent, child, stranger] = [await merchant(), await merchant(), await merchant()];
  await pool.query(`INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, 10000)`, [parent, child]);
  assert.equal(await resolveReportMerchantId(pool, parent, child), child);
  assert.equal(await resolveReportMerchantId(pool, stranger, child), stranger, "a stranger must stay on its own data");
});
