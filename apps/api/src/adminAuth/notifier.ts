
import type { Config } from "../config.js";
import type { MinimalLogger } from "../auth/notifier.js";

/**
 * Admin OTP delivery stub.
 *
 * Development and test environments log the OTP code.
 * Production logs the OTP code only when:
 * - OTP_LOG_CODE=true
 * - The admin ID is in OTP_LOG_ADMIN_USER_IDS
 *
 * All other production OTP events are logged without the code.
 */
export function sendAdminOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "nodeEnv"> & {
    otpLogCode?: boolean;
    otpLogAdminUserIds?: string[];
  },
  recipient: { adminUserId: string; email: string },
  code: string,
): void {
  const canLogCode =
    config.nodeEnv !== "production" ||
    (
      config.otpLogCode === true &&
      config.otpLogAdminUserIds?.includes(recipient.adminUserId) === true
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
