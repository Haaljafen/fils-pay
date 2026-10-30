
import type { Config } from "../config.js";
import { sendOtpEmail, type EmailConfig } from "./emailOtp.js";

/**
 * Subset of the Fastify logger, so tests can pass a stub.
 */
export interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

/**
 * OTP delivery stub.
 *
 * No email/SMS integration exists yet.
 *
 * Development and test environments log the OTP code.
 * Production logs the OTP code only when:
 * - OTP_LOG_CODE=true
 * - The merchant ID is in OTP_LOG_MERCHANT_USER_IDS
 *
 * All other production OTP events are logged without the code.
 */
export function sendOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "nodeEnv"> & Partial<EmailConfig> & {
    otpLogCode?: boolean;
    otpLogMerchantUserIds?: string[];
  },
  recipient: { merchantUserId: string; email: string },
  code: string,
): void {
  // Real delivery: when SMTP is configured the code is emailed (never part of the HTTP response).
  if (config.smtpHost || config.resendApiKey) {
    void sendOtpEmail(config as EmailConfig, logger, recipient.email, code);
  }

  const canLogCode =
    config.nodeEnv !== "production" ||
    (
      config.otpLogCode === true &&
      // An empty/absent allowlist means "everyone"; a non-empty one restricts logging to those users.
      (!config.otpLogMerchantUserIds?.length || config.otpLogMerchantUserIds.includes(recipient.merchantUserId))
    );

  if (canLogCode) {
    logger.info(
      {
        merchantUserId: recipient.merchantUserId,
        channel: "otp",
        code,
      },
      config.nodeEnv === "production"
        ? "otp code generated (allowlisted operator log)"
        : "otp code generated (dev)",
    );
  } else {
    logger.info(
      {
        merchantUserId: recipient.merchantUserId,
        channel: "otp",
      },
      "otp code generated",
    );
  }
}
