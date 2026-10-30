import assert from "node:assert/strict";
import { test } from "node:test";
import { sendOtpCode } from "./notifier.js";
import { sendAdminOtpCode } from "../adminAuth/notifier.js";

function capture() {
  const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  return { lines, logger: { info: (obj: Record<string, unknown>, msg: string) => void lines.push({ obj, msg }) } };
}
const user = { merchantUserId: "u1", email: "a@b.test" };
const admin = { adminUserId: "a1", email: "a@b.test" };

test("production never logs the code unless the switch is on, and a non-empty allowlist must include the user", () => {
  const c = capture();
  sendOtpCode(c.logger, { nodeEnv: "production" }, user, "111111");
  sendOtpCode(c.logger, { nodeEnv: "production", otpLogCode: false, otpLogMerchantUserIds: ["u1"] }, user, "111111");
  sendOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true, otpLogMerchantUserIds: ["other"] }, user, "111111");
  sendAdminOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true, otpLogAdminUserIds: ["someone-else"] }, admin, "222222");
  assert.equal(c.lines.length, 4);
  for (const l of c.lines) assert.equal("code" in l.obj, false, l.msg);
});

test("the email allowlist logs a code for a user whose id is not yet known (new registrations)", () => {
  const c = capture();
  const fresh = { merchantUserId: "brand-new-id", email: "New.Merchant@Example.test" };
  // Email matches (case-insensitive) even though the id is not on the id list.
  sendOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true, otpLogMerchantUserIds: [], otpLogMerchantEmails: ["new.merchant@example.test"] }, fresh, "333333");
  // A different email on the same list is not logged.
  sendOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true, otpLogMerchantUserIds: [], otpLogMerchantEmails: ["someone@else.test"] }, fresh, "444444");
  assert.deepEqual(c.lines.map((l) => l.obj.code), ["333333", undefined]);
});

test("an allowlisted user's code is written to the operator log", () => {
  const c = capture();
  sendOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true, otpLogMerchantUserIds: ["u1"] }, user, "111111");
  sendAdminOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true, otpLogAdminUserIds: ["a1"] }, admin, "222222");
  assert.deepEqual(c.lines.map((l) => l.obj.code), ["111111", "222222"]);
});
