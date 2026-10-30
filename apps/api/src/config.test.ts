import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const DATABASE_URL = "postgres://filspay:pw@localhost:5432/filspay";

test("outside production, the built-in dev webhook key loads and is exactly 32 bytes", () => {
  const config = loadConfig({ DATABASE_URL, NODE_ENV: "development" });
  assert.equal(Buffer.from(config.webhookSecretEncryptionKey, "base64").length, 32);
});

test("the dev key is the same on every boot, so the seed and the API can decrypt each other's secrets", () => {
  const first = loadConfig({ DATABASE_URL, NODE_ENV: "development" });
  const second = loadConfig({ DATABASE_URL, NODE_ENV: "test" });
  assert.equal(first.webhookSecretEncryptionKey, second.webhookSecretEncryptionKey);
});

test("in production, a missing WEBHOOK_SECRET_ENCRYPTION_KEY fails boot instead of using the dev key", () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL,
        NODE_ENV: "production",
        SETTLEMENT_INTERNAL_TOKEN: "t",
        ACQUIRER_CALLBACK_SIGNING_SECRET: "s",
        CHECKOUT_BASE_URL: "https://pay.example.com",
      }),
    /WEBHOOK_SECRET_ENCRYPTION_KEY/,
  );
});

test("OTP codes are not returned in login responses unless OTP_DEV_EXPOSE is set explicitly", () => {
  for (const NODE_ENV of ["development", "test", undefined, "staging"]) {
    assert.equal(loadConfig({ DATABASE_URL, NODE_ENV }).otpDevExpose, false, `NODE_ENV=${NODE_ENV}`);
  }
  assert.equal(loadConfig({ DATABASE_URL, NODE_ENV: "development", OTP_DEV_EXPOSE: "true" }).otpDevExpose, true);
});

test("OTP_DEV_EXPOSE=true with NODE_ENV=production fails boot", () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL,
        NODE_ENV: "production",
        OTP_DEV_EXPOSE: "true",
        SETTLEMENT_INTERNAL_TOKEN: "t",
        ACQUIRER_CALLBACK_SIGNING_SECRET: "s",
        WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      }),
    /OTP_DEV_EXPOSE/,
  );
});

const PRODUCTION_SECRETS = {
  SETTLEMENT_INTERNAL_TOKEN: "t",
  ACQUIRER_CALLBACK_SIGNING_SECRET: "s",
  WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

test("OTP_LOG_CODE is off unless set, boots in production, and does not put the code in responses", () => {
  const production = {
    DATABASE_URL,
    NODE_ENV: "production",
    CHECKOUT_BASE_URL: "https://pay.example.com",
    ...PRODUCTION_SECRETS,
  };
  assert.equal(loadConfig(production).otpLogCode, false);
  const on = loadConfig({ ...production, OTP_LOG_CODE: "true" });
  assert.equal(on.otpLogCode, true);
  assert.equal(on.otpDevExpose, false);
});

test("in production a missing CHECKOUT_BASE_URL fails boot instead of sending customers to localhost", () => {
  assert.throws(() => loadConfig({ DATABASE_URL, NODE_ENV: "production", ...PRODUCTION_SECRETS }), /CHECKOUT_BASE_URL/);
});

test("in production CHECKOUT_BASE_URL must be https", () => {
  assert.throws(
    () => loadConfig({ DATABASE_URL, NODE_ENV: "production", ...PRODUCTION_SECRETS, CHECKOUT_BASE_URL: "http://pay.example.com" }),
    /CHECKOUT_BASE_URL/,
  );
  const config = loadConfig({ DATABASE_URL, NODE_ENV: "production", ...PRODUCTION_SECRETS, CHECKOUT_BASE_URL: "https://pay.example.com" });
  assert.equal(config.checkoutBaseUrl, "https://pay.example.com");
});
