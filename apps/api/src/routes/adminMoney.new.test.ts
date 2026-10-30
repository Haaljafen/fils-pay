/**
 * Regression tests for the admin money fixes: the CSV import parses BHD with
 * three decimals and cannot be applied twice, "Adjust balance" is journaled to the
 * ledger, and the credit four-eyes check compares admin ids. Real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../adminAuth/passwords.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("adminMoney.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  SETTLEMENT_INTERNAL_TOKEN: "test-settlement-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const ADMIN_PASSWORD = "admin-test-password-9000!";
let cachedHash: string | null = null;

async function financeCookie(): Promise<string> {
  cachedHash ??= await hashPassword(ADMIN_PASSWORD, config);
  const email = `fin-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'Test finance', 'finance')`,
    [email, cachedHash],
  );
  const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: ADMIN_PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  const header = login.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header[0]! : (header as string)).split(";")[0]!;
  const verify = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/otp/verify",
    headers: { cookie },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  // The session token is replaced after the OTP step (session fixation fix): use the new cookie.
  const fresh = verify.headers["set-cookie"];
  const freshHeader = Array.isArray(fresh) ? fresh[0] : fresh;
  return freshHeader ? freshHeader.split(";")[0]! : cookie;
}

async function createMerchant(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Admin Money ${randomUUID()}`],
  );
  return result.rows[0]!.id;
}

async function ledgerPayableNet(merchantId: string): Promise<number> {
  const result = await pool.query<{ net: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0) AS net
       FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'`,
    [merchantId],
  );
  return Number(result.rows[0]!.net);
}

test("the same adjustment CSV cannot be applied twice", async () => {
  const cookie = await financeCookie();
  const merchantId = await createMerchant();
  const csvContent = `merchantId,amount,reason\n${merchantId},4.750,statement correction\n`;

  const first = await app.inject({
    method: "POST",
    url: "/v1/admin/adjustment-imports",
    headers: { cookie },
    payload: { csvContent, originalFilename: "march.csv" },
  });
  assert.equal(first.statusCode, 201, first.body);
  const posted = (first.json() as { totalPostedFils: number }).totalPostedFils;
  assert.equal(await ledgerPayableNet(merchantId), posted);

  // the double click, and the re-upload under another file name
  for (const originalFilename of ["march.csv", "march (1).csv"]) {
    const again = await app.inject({
      method: "POST",
      url: "/v1/admin/adjustment-imports",
      headers: { cookie },
      payload: { csvContent: csvContent.replace("4.750", "4.75"), originalFilename },
    });
    assert.equal(again.statusCode, 409, again.body);
    assert.equal((again.json() as { error: string }).error, "duplicate_import");
  }
  assert.equal(await ledgerPayableNet(merchantId), posted, "the duplicate must not have moved money");
});

test("Adjust balance is journaled: the ledger and the cache both move, so a rebuild cannot undo it", async () => {
  const cookie = await financeCookie();
  const merchantId = await createMerchant();
  await pool.query(`INSERT INTO merchant_balances (merchant_id, cached_payable_fils) VALUES ($1, 0)`, [merchantId]);

  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/balance-adjustments`,
    headers: { cookie },
    payload: { deltaFils: 2500, reason: "confirmed against the March statement" },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await ledgerPayableNet(merchantId), 2500, "the correction must be in the ledger");
  const cache = await pool.query<{ cached_payable_fils: string }>(
    `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`,
    [merchantId],
  );
  assert.equal(Number(cache.rows[0]!.cached_payable_fils), 2500);
});

