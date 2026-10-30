/**
 * Regression tests for the login and session security fixes. Needs
 * DATABASE_URL to point at a real, migrated Postgres, like app.test.ts.
 *
 * Each test names the bug it pins down, so a failure points straight at the
 * control that stopped working.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { startImpersonation, lookupImpersonationGrant } from "../admin/impersonation.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("securityRegressions.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const kycUploadDir = mkdtempSync(join(tmpdir(), "filspay-sec-test-"));
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: kycUploadDir,
  OTP_DEV_EXPOSE: "true",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

function cookieOf(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error("expected a Set-Cookie header");
  return header.split(";")[0] as string;
}

async function signup(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `Sec Test ${randomUUID().slice(0, 8)}`,
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: uniqueEmail("contact"),
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password },
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { merchantId: string }).merchantId;
}

async function passwordStep(merchantId: string, email: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { devOtpCode: string };
  return { cookie: cookieOf(res.headers["set-cookie"]), code: body.devOtpCode };
}

async function verify(cookie: string, code: string) {
  return app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code } });
}

function wrongCode(real: string, n: number): string {
  // Always a 6-digit code that differs from the real one.
  const candidate = String(100000 + n).padStart(6, "0");
  return candidate === real ? "999999" : candidate;
}

test("the session cookie from the password step alone does not authenticate anything (2FA bypass)", async () => {
  const email = uniqueEmail("pending");
  const merchantId = await signup(email, "a-strong-password-1!");
  const { cookie } = await passwordStep(merchantId, email, "a-strong-password-1!");

  for (const url of ["/v1/auth/me", "/v1/transactions", `/v1/merchants/${merchantId}/payment-links`]) {
    const res = await app.inject({ method: "GET", url, headers: { cookie } });
    assert.equal(res.statusCode, 401, `${url} must reject a pending session, got ${res.statusCode}`);
  }
});

test("the same email under two merchants: each login yields a session for the merchant that was logged in to", async () => {
  const email = uniqueEmail("shared-tenant");
  const merchantA = await signup(email, "password-for-merchant-a-1!");
  const merchantB = await signup(email, "password-for-merchant-b-2!");

  // B logs in with B's credentials. The old code looked the user up again by
  // email alone, found A's older row, and issued B's login a session for A.
  const b = await passwordStep(merchantB, email, "password-for-merchant-b-2!");
  const verifiedB = await verify(b.cookie, b.code);
  assert.equal(verifiedB.statusCode, 200);
  const meB = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: cookieOf(verifiedB.headers["set-cookie"]) } });
  assert.equal(meB.json().merchant.id, merchantB, "a login to merchant B must produce a session for merchant B");

  const a = await passwordStep(merchantA, email, "password-for-merchant-a-1!");
  const verifiedA = await verify(a.cookie, a.code);
  assert.equal(verifiedA.statusCode, 200);
  const meA = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: cookieOf(verifiedA.headers["set-cookie"]) } });
  assert.equal(meA.json().merchant.id, merchantA);
});

test("parallel wrong OTP guesses are capped at max_attempts and the right code is refused afterwards", async () => {
  const email = uniqueEmail("race");
  const merchantId = await signup(email, "a-strong-password-1!");
  const { cookie, code } = await passwordStep(merchantId, email, "a-strong-password-1!");

  const results = await Promise.all(Array.from({ length: 30 }, (_, n) => verify(cookie, wrongCode(code, n))));
  assert.ok(results.every((r) => r.statusCode === 401 || r.statusCode === 429), "no guess may succeed");

  const challenge = await pool.query<{ attempt_count: number; max_attempts: number }>(
    `SELECT oc.attempt_count, oc.max_attempts
       FROM otp_challenges oc JOIN merchant_users mu ON mu.id = oc.merchant_user_id
      WHERE mu.merchant_id = $1 ORDER BY oc.created_at DESC LIMIT 1`,
    [merchantId],
  );
  const row = challenge.rows[0]!;
  assert.equal(row.attempt_count, row.max_attempts, "exactly max_attempts guesses were counted, not one per racing request");

  // The budget is spent: even the correct code no longer logs in.
  const late = await verify(cookie, code);
  assert.ok(late.statusCode === 401 || late.statusCode === 429, `correct code after lockout got ${late.statusCode}`);
});

test("asking for a new code does not refresh the guess budget", async () => {
  const email = uniqueEmail("resend");
  const merchantId = await signup(email, "a-strong-password-1!");
  const { cookie, code } = await passwordStep(merchantId, email, "a-strong-password-1!");

  for (let n = 0; n < 3; n++) {
    assert.equal((await verify(cookie, wrongCode(code, n))).statusCode, 401);
  }

  // Skip the 30 second resend throttle.
  await pool.query(
    `UPDATE otp_challenges SET created_at = now() - interval '2 minutes'
      WHERE merchant_user_id IN (SELECT id FROM merchant_users WHERE merchant_id = $1)`,
    [merchantId],
  );
  const resend = await app.inject({ method: "POST", url: "/v1/auth/otp/resend", headers: { cookie } });
  assert.equal(resend.statusCode, 200, resend.body);
  const fresh = (resend.json() as { devOtpCode: string }).devOtpCode;

  const carried = await pool.query<{ attempt_count: number }>(
    `SELECT oc.attempt_count FROM otp_challenges oc JOIN merchant_users mu ON mu.id = oc.merchant_user_id
      WHERE mu.merchant_id = $1 ORDER BY oc.created_at DESC LIMIT 1`,
    [merchantId],
  );
  assert.equal(carried.rows[0]!.attempt_count, 3, "the new challenge starts from the old attempt count");

  // Two more wrong guesses exhaust the original budget of five.
  assert.equal((await verify(cookie, wrongCode(fresh, 10))).statusCode, 401);
  assert.equal((await verify(cookie, wrongCode(fresh, 11))).statusCode, 401);
  const lockedOut = await verify(cookie, fresh);
  assert.ok(lockedOut.statusCode === 401 || lockedOut.statusCode === 429, `got ${lockedOut.statusCode}`);
});

async function createAdmin(role: "support" | "finance" | "super_admin"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, 'not-a-real-hash', $2, $3) RETURNING id`,
    [uniqueEmail("admin"), `Admin ${role}`, role],
  );
  return result.rows[0]!.id;
}

