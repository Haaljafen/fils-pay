/**
 * With OTP_LOG_CODE on in production, the code goes to the log and must never
 * reach a login response. Needs DATABASE_URL to point at a real, migrated
 * Postgres, like app.test.ts.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "./passwords.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("otpLogCode.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "production",
  OTP_LOG_CODE: "true",
  CHECKOUT_BASE_URL: "https://pay.example.com",
  SETTLEMENT_INTERNAL_TOKEN: "t",
  ACQUIRER_CALLBACK_SIGNING_SECRET: "s",
  WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const PASSWORD = "correct horse battery staple 1!";

test("merchant login response has no code", async () => {
  const email = `otp-log-${randomUUID()}@example.test`;
  const signup = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: "OTP Log Co",
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: email,
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password: PASSWORD },
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  const { merchantId } = signup.json() as { merchantId: string };

  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { merchantId, email, password: PASSWORD },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.deepEqual(Object.keys(login.json() as object).sort(), ["otpExpiresAt", "otpRequired"]);
});

test("admin login response has no code", async () => {
  const email = `otp-log-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'OTP log test', 'finance')`,
    [email, await hashPassword(PASSWORD, config)],
  );
  const login = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    payload: { email, password: PASSWORD },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.deepEqual(Object.keys(login.json() as object).sort(), ["otpExpiresAt", "otpRequired"]);
});
