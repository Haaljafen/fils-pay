import assert from "node:assert/strict";
import { test } from "node:test";
import { sendAdminOtpCode } from "../adminAuth/notifier.js";
import { sendOtpCode, type MinimalLogger } from "./notifier.js";

const CODE = "123456";

/** Everything both notifiers wrote, as text, so a test can look for the code anywhere in it. */
function logged(send: (logger: MinimalLogger) => void): string {
  const lines: unknown[] = [];
  send({ info: (obj, msg) => lines.push({ ...obj, msg }) });
  assert.equal(lines.length, 1);
  return JSON.stringify(lines);
}

function bothNotifiers(config: { nodeEnv: "production" | "development"; otpLogCode: boolean }): string[] {
  return [
    logged((logger) => sendOtpCode(logger, config, { merchantUserId: "u1", email: "a@example.test" }, CODE)),
    logged((logger) => sendAdminOtpCode(logger, config, { adminUserId: "a1", email: "b@example.test" }, CODE)),
  ];
}

test("production logs no OTP code unless OTP_LOG_CODE is on", () => {
  for (const line of bothNotifiers({ nodeEnv: "production", otpLogCode: false })) {
    assert.ok(!line.includes(CODE), line);
  }
});

test("production logs the OTP code when OTP_LOG_CODE is on", () => {
  for (const line of bothNotifiers({ nodeEnv: "production", otpLogCode: true })) {
    assert.ok(line.includes(CODE), line);
  }
});

test("the logged OTP line never carries the recipient's email", () => {
  for (const line of bothNotifiers({ nodeEnv: "production", otpLogCode: true })) {
    assert.ok(!line.includes("@example.test"), line);
  }
});

test("development still logs the OTP code without the setting", () => {
  for (const line of bothNotifiers({ nodeEnv: "development", otpLogCode: false })) {
    assert.ok(line.includes(CODE), line);
  }
});
