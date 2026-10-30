import type { Config } from "../config.js";

/**
 * OTP delivery stub. No real email/SMS integration exists or is needed at
 * this stage. Always logs a structured line; only includes the raw code in
 * the log when `config.nodeEnv !== 'production'`, or in production when
 * `config.otpLogCode` is on.
 */
/** Subset of the Fastify logger, so tests can pass a stub. */
export interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

// Outside production the code is logged in plaintext so local development can
// log in. A hosted box must run NODE_ENV=production, or the code lands in its
// logs. There is no email/SMS sender yet, so production delivers no code unless
// OTP_LOG_CODE=true writes it to the log for someone with server access to read.
export function sendOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "nodeEnv" | "otpLogCode">,
  recipient: { merchantUserId: string; email: string },
  code: string,
): void {
  if (config.nodeEnv === "production") {
    logger.info(
      { merchantUserId: recipient.merchantUserId, channel: "otp", ...(config.otpLogCode ? { code } : {}) },
      "otp code generated",
    );
  } else {
    logger.info(
      { merchantUserId: recipient.merchantUserId, channel: "otp", code },
      "otp code generated (dev)",
    );
  }
}
