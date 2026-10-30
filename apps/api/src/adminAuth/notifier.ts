
import type { Config } from "../config.js";
import { sendOtpEmail, type EmailConfig } from "../auth/emailOtp.js";
import type { MinimalLogger } from "../auth/notifier.js";

export function sendAdminOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "nodeEnv"> & Partial<EmailConfig> & {
    otpLogCode?: boolean;
    otpLogAdminUserIds?: string[];
  },
  recipient: { adminUserId: string; email: string },
  code: string,
): void {
  if (config.smtpHost || config.resendApiKey) {
    void sendOtpEmail(config as EmailConfig, logger, recipient.email, code);
  }

  const canLogCode =
    config.nodeEnv !== "production" ||
    (
      config.otpLogCode === true &&
      (!config.otpLogAdminUserIds?.length || config.otpLogAdminUserIds.includes(recipient.adminUserId))
    );

  if (canLogCode) {
    logger.info(
      {
        adminUserId: recipient.adminUserId,
        channel: "admin_otp",
        code,
      },
      config.nodeEnv === "production"
        ? "admin otp code generated (allowlisted operator log)"
        : "admin otp code generated (dev)",
    );
  } else {
    logger.info(
      {
        adminUserId: recipient.adminUserId,
        channel: "admin_otp",
      },
      "admin otp code generated",
    );
  }
}
