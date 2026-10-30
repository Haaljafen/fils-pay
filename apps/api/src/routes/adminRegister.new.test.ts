import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("adminRegister.new.test.ts requires DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const app = buildApp(
  loadConfig({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    OTP_DEV_EXPOSE: "true",
    WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  }),
  pool,
);

test.after(async () => {
  await app.close();
  await pool.end();
});

const body = (over: Record<string, unknown> = {}) => ({
  email: `Mixed-${randomUUID()}@Admin.Test`,
  password: "a-long-enough-password",
  displayName: "New Admin",
  ...over,
});
const register = (payload: unknown) => app.inject({ method: "POST", url: "/v1/admin/auth/register", payload: payload as object });
const login = (email: string, password: string) => app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password } });

test("registering creates a pending support admin who cannot sign in until activated", async () => {
  const b = body();
  const res = await register(b);
  assert.equal(res.statusCode, 201, res.body);
  assert.equal((res.json() as { status: string }).status, "pending_approval");

  const row = await pool.query<{ role: string; status: string }>(`SELECT role, status FROM admin_users WHERE lower(email) = lower($1)`, [b.email]);
  assert.equal(row.rows[0]!.role, "support", "self-registered admins start at the lowest role");
  assert.equal(row.rows[0]!.status, "disabled", "and are not usable until approved");

  assert.equal((await login(b.email, b.password)).statusCode, 401, "a pending account must not be able to start a login");

  await pool.query(`UPDATE admin_users SET status = 'active' WHERE lower(email) = lower($1)`, [b.email]);
  const ok = await login(b.email.toUpperCase(), b.password);
  assert.equal(ok.statusCode, 200, ok.body);
});

test("weak passwords, bad emails and duplicate emails are rejected", async () => {
  assert.equal((await register(body({ password: "short" }))).statusCode, 400);
  assert.equal((await register(body({ email: "nope" }))).statusCode, 400);
  const dup = body();
  assert.equal((await register(dup)).statusCode, 201);
  assert.equal((await register(dup)).statusCode, 409);
});
