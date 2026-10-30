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

test("production never logs the code unless the switch AND the user's id allowlist both say so", () => {
  const c = capture();
  sendOtpCode(c.logger, { nodeEnv: "production" }, user, "111111");
  sendOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true }, user, "111111");
  sendOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true, otpLogMerchantUserIds: ["other"] }, user, "111111");
  sendAdminOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true, otpLogAdminUserIds: [] }, admin, "222222");
  assert.equal(c.lines.length, 4);
  for (const l of c.lines) assert.equal("code" in l.obj, false, l.msg);
});

test("an allowlisted user's code is written to the operator log", () => {
  const c = capture();
  sendOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true, otpLogMerchantUserIds: ["u1"] }, user, "111111");
  sendAdminOtpCode(c.logger, { nodeEnv: "production", otpLogCode: true, otpLogAdminUserIds: ["a1"] }, admin, "222222");
  assert.deepEqual(c.lines.map((l) => l.obj.code), ["111111", "222222"]);
});
