import assert from "node:assert/strict";
import { test } from "node:test";
import { sendOtpEmail, type EmailConfig } from "./emailOtp.js";

const base: EmailConfig = { smtpHost: "smtp.test", smtpPort: 587, smtpUser: "u", smtpPass: "p", smtpFrom: "FilsPay <noreply@test>", resendApiKey: "", otpEmailOverride: "" };
function logger() {
  const lines: Array<{ o: Record<string, unknown>; m: string }> = [];
  return { lines, log: { info: (o: Record<string, unknown>, m: string) => void lines.push({ o, m }) } };
}

test("no SMTP host: nothing is sent", () => {
  assert.equal(sendOtpEmail({ ...base, smtpHost: "" }, logger().log, "a@b.test", "123456", async () => assert.fail("must not send")), undefined);
});

test("the code is emailed to the user's address, and never written to the log", async () => {
  const sent: Array<{ to: string; text: string; from: string }> = [];
  const l = logger();
  await sendOtpEmail(base, l.log, "owner@shop.test", "482913", async (m) => void sent.push(m));
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, "owner@shop.test");
  assert.match(sent[0]!.text, /482913/);
  assert.equal(JSON.stringify(l.lines).includes("482913"), false);
});

test("the demo override sends every code to one inbox", async () => {
  const sent: string[] = [];
  await sendOtpEmail({ ...base, otpEmailOverride: "demo@inbox.test" }, logger().log, "owner@placeholder.example", "111111", async (m) => void sent.push(m.to));
  assert.deepEqual(sent, ["demo@inbox.test"]);
});

test("a mail failure is logged, not thrown, so a login can never be blocked by it", async () => {
  const l = logger();
  await sendOtpEmail(base, l.log, "a@b.test", "222222", async () => { throw new Error("connect ETIMEDOUT"); });
  assert.equal(l.lines[0]!.m, "otp email failed");
  assert.equal(JSON.stringify(l.lines).includes("222222"), false);
});
