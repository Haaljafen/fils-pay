import type { Config } from "../config.js";

/**
 * OTP delivery stub. No real email/SMS integration exists or is needed at
 * this stage. Always logs a structured line; only includes the raw code in
 * the log when `config.nodeEnv !== 'production'` — production never logs
 * the code itself.
 */
/** Subset of the Fastify logger, so tests can pass a stub. */
export interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

// Outside production the code is logged in plaintext so local development can
// log in. A hosted box must run NODE_ENV=production, or the code lands in its
// logs. There is no email/SMS sender yet, so production delivers no code at all.
export function sendOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "nodeEnv">,
  recipient: { merchantUserId: string; email: string },
  code: string,
): void {
  if (config.nodeEnv === "production") {
    logger.info({ merchantUserId: recipient.merchantUserId, channel: "otp" }, "otp code generated");
  } else {
    logger.info(
      { merchantUserId: recipient.merchantUserId, channel: "otp", code },
      "otp code generated (dev)",
    );
  }
}
