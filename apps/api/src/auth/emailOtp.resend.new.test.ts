import assert from "node:assert/strict";
import { test } from "node:test";
import { resendSend, sendOtpEmail, type EmailConfig } from "./emailOtp.js";

const base: EmailConfig = {
  smtpHost: "", smtpPort: 587, smtpUser: "", smtpPass: "", smtpFrom: "", resendApiKey: "re_test_key", otpEmailOverride: "",
};
const logger = () => {
  const lines: Array<{ o: Record<string, unknown>; m: string }> = [];
  return { lines, log: { info: (o: Record<string, unknown>, m: string) => void lines.push({ o, m }) } };
};

test("resendSend posts the message to Resend with the bearer key", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  await resendSend("re_test_key", fake)({ from: "FilsPay <onboarding@resend.dev>", to: "a@b.test", subject: "s", text: "code 123456" });
  assert.equal(calls[0]!.url, "https://api.resend.com/emails");
  assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, "Bearer re_test_key");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)).to, ["a@b.test"]);
});

test("a non-2xx answer from Resend is an error that sendOtpEmail logs but never throws", async () => {
  const fake = (async () => new Response("nope", { status: 403 })) as typeof fetch;
  const l = logger();
  await sendOtpEmail(base, l.log, "a@b.test", "654321", resendSend("re_test_key", fake));
  assert.equal(l.lines[0]!.m, "otp email failed");
  assert.equal(JSON.stringify(l.lines).includes("654321"), false);
});

test("with no Resend key and no SMTP host, nothing is sent", () => {
  assert.equal(sendOtpEmail({ ...base, resendApiKey: "" }, logger().log, "a@b.test", "111111"), undefined);
});
