import nodemailer, { type Transporter } from "nodemailer";
import type { Config } from "../config.js";

/** The subset of config the mailer reads. All empty = email delivery is off. */
export type EmailConfig = Pick<
  Config,
  "smtpHost" | "smtpPort" | "smtpUser" | "smtpPass" | "smtpFrom" | "resendApiKey" | "otpEmailOverride"
>;

export type Send = (message: { from: string; to: string; subject: string; text: string }) => Promise<unknown>;

const DEFAULT_FROM = "FilsPay <onboarding@resend.dev>";

let cached: { key: string; transporter: Transporter } | null = null;

function smtpSend(config: EmailConfig): Send {
  const key = `${config.smtpHost}:${config.smtpPort}:${config.smtpUser}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      transporter: nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465,
        auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
        connectionTimeout: 8_000,
        socketTimeout: 10_000,
      }),
    };
  }
  return (message) => cached!.transporter.sendMail(message);
}

/**
 * Sends through Resend's HTTPS API (port 443). Used instead of SMTP on hosts that block outbound mail ports.
 * `fetchImpl` is injectable so tests never touch the network.
 */
export function resendSend(apiKey: string, fetchImpl: typeof fetch = fetch): Send {
  return async (message) => {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`resend responded ${res.status}`);
    return res.json();
  };
}

/**
 * Emails a one-time login code. Fire-and-forget by design: a mail outage must never block or fail a login
 * (the user can resend), so errors are logged, never thrown, and the code is never written to the log.
 * Resend is preferred when RESEND_API_KEY is set; otherwise SMTP. `otpEmailOverride` sends every code to one
 * address, for a demo whose seeded accounts have placeholder emails.
 */
export function sendOtpEmail(
  config: EmailConfig,
  logger: { info: (o: Record<string, unknown>, m: string) => void },
  recipientEmail: string,
  code: string,
  send?: Send,
): Promise<void> | undefined {
  if (!config.resendApiKey && !config.smtpHost) return undefined;
  const transport = send ?? (config.resendApiKey ? resendSend(config.resendApiKey) : smtpSend(config));
  const to = config.otpEmailOverride || recipientEmail;
  return transport({
    from: config.smtpFrom || DEFAULT_FROM,
    to,
    subject: "Your FilsPay sign-in code",
    text: `Your FilsPay one-time code is ${code}. It expires in a few minutes. If you did not try to sign in, ignore this email.`,
  }).then(
    () => logger.info({ channel: "email", to }, "otp email sent"),
    (err: unknown) => logger.info({ channel: "email", to, error: err instanceof Error ? err.message : String(err) }, "otp email failed"),
  );
}
