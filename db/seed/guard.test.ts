import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSeedTargetIsResettable } from "./guard.js";

const local = { connectionString: "postgres://filspay:pw@localhost:5432/filspay", host: undefined };
const compose = { connectionString: "postgres://filspay:pw@postgres:5432/filspay?sslmode=disable", host: undefined };
const remote = { connectionString: "postgres://filspay:pw@db.staging.example.com:5432/filspay", host: undefined };

test("a local or compose database can be reset", () => {
  assert.doesNotThrow(() => assertSeedTargetIsResettable(local, {}));
  assert.doesNotThrow(() => assertSeedTargetIsResettable(compose, {}));
});

test("a remote database is refused and the error names its host", () => {
  assert.throws(() => assertSeedTargetIsResettable(remote, {}), /db\.staging\.example\.com/);
});

test("SEED_ALLOW_RESET=1 allows a remote database", () => {
  assert.doesNotThrow(() => assertSeedTargetIsResettable(remote, { SEED_ALLOW_RESET: "1" }));
});

test("NODE_ENV=production is refused even for a local database and with the opt-in", () => {
  assert.throws(() => assertSeedTargetIsResettable(local, { NODE_ENV: "production", SEED_ALLOW_RESET: "1" }), /production/);
});

test("without a connection string, the host falls back to PGHOST", () => {
  assert.throws(
    () => assertSeedTargetIsResettable({ connectionString: undefined, host: undefined }, { PGHOST: "10.0.0.5" }),
    /10\.0\.0\.5/,
  );
  assert.doesNotThrow(() => assertSeedTargetIsResettable({ connectionString: undefined, host: undefined }, {}));
});
