import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const env = {
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
};

test("GET /healthz/db answers 503 when the database is unreachable, while /readyz stays boot-only", async () => {
  const config = loadConfig({ ...env, DATABASE_URL: "postgres://nobody:nope@127.0.0.1:1/none" });
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 500 });
  pool.on("error", () => {});
  const app = buildApp(config, pool);
  try {
    const res = await app.inject({ method: "GET", url: "/healthz/db" });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().status, "db_unavailable");
    const live = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(live.statusCode, 200);
  } finally {
    await app.close();
    await pool.end().catch(() => {});
  }
});

test("GET /healthz/db answers 200 against a live database", async () => {
  const url = process.env.DATABASE_URL;
  assert.ok(url, "DATABASE_URL is required");
  const config = loadConfig({ ...env, DATABASE_URL: url });
  const pool = new Pool({ connectionString: url, max: 1 });
  const app = buildApp(config, pool);
  try {
    const res = await app.inject({ method: "GET", url: "/healthz/db" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "ok");
  } finally {
    await app.close();
    await pool.end();
  }
});
