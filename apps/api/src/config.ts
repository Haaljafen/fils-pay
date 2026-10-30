/**
 * App-wide configuration, loaded once from environment variables at boot.
 * `loadConfig` throws synchronously — crashing boot rather than serving
 * traffic in a half-configured state — if `DATABASE_URL` is missing, or if
 * `SETTLEMENT_INTERNAL_TOKEN` is missing while `nodeEnv === 'production'`.
 *
 * Later sub-phases add their own fields to this same interface/loader
 * rather than introducing a second config system.
 */
export interface Config {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;

  pgPoolMax: number;
  pgPoolMin: number;
  pgPoolIdleTimeoutMs: number;
  pgPoolConnectionTimeoutMs: number;

  sessionTtlHours: number;
  pendingSessionTtlMinutes: number;
  otpTtlMinutes: number;
  otpCodeLength: number;
  otpMaxAttempts: number;
  /** Returns the OTP code in the login response (`devOtpCode`), for local
   *  development without an email/SMS sender. Off unless OTP_DEV_EXPOSE=true:
   *  when on, the password alone logs anyone in, so it must never depend on
   *  NODE_ENV being set correctly on a hosted box. Refused in production. */
  otpDevExpose: boolean;
  /** Write the OTP code to the server's own log (never to the HTTP response). Off by default; see auth/notifier.ts. */
  otpLogCode: boolean;

  /** Email delivery of OTP codes. Off unless SMTP_HOST is set. */
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  /** Resend HTTPS email API key. When set, OTP emails go through Resend instead of SMTP. */
  resendApiKey: string;
  /** Send every OTP email to this one address (demo only; the seeded accounts have placeholder emails). */
  otpEmailOverride: string;
  /** With otpLogCode, only these user ids get their code logged (comma-separated env lists). */
  otpLogMerchantUserIds: string[];
  otpLogAdminUserIds: string[];

  argon2MemoryKib: number;
  argon2TimeCost: number;
  argon2Parallelism: number;

  kycUploadDir: string;
  kycMaxFileSizeBytes: number;

  acquirerLatencyMinMs: number;
  acquirerLatencyMaxMs: number;
  acquirerFailureRate: number;
  acquirerRngSeed: number | null;

  cookieName: string;
  cookieSecure: boolean;

  /** Cookie carrying an `admin_sessions` token. A completely separate name,
   *  table, and code path from `cookieName`/`sessions` — `requireAdminSession`
   *  reads only this one and `requireMerchantAuth` never reads it at all, so
   *  an admin session can never be resolved as merchant authority. */
  adminCookieName: string;
  /** Deliberately shorter than a merchant session's 12h — a minor extra
   *  caution for the higher-privilege plane. */
  adminSessionTtlHours: number;
  adminPendingSessionTtlMinutes: number;
  adminOtpTtlMinutes: number;
  adminOtpCodeLength: number;
  adminOtpMaxAttempts: number;

  /** Cookie carrying an `admin_impersonation_grants` token — the third,
   *  distinct cookie in the system. Read only by `requireMerchantAuth`, and
   *  never by `requireAdminSession`: the privilege drop is structural, not a
   *  flag that could fail to be cleared. */
  impersonationCookieName: string;
  /** Bounded lifetime of a "view as merchant" grant. Checked on every
   *  lookup — there is no "until logout" path. */
  impersonationTtlMinutes: number;

  /** Base URL of apps/settlement's internal HTTP server, reachable only
   *  inside the compose network. The API delegates settlement operations
   *  (batch runs, balance refreshes) through this. */
  settlementInternalUrl: string;
  /** Bearer token for that internal server. Required in production, same
   *  posture the retired `internalApiToken` had. */
  settlementInternalToken: string;
  /** Timeout for an internal settlement call. Generous on purpose: a full
   *  daily batch across every merchant genuinely takes longer than a typical
   *  API-latency budget. */
  settlementInternalRequestTimeoutMs: number;

  /** Base URL of apps/web's hosted checkout, used only to build the
   *  convenience `url` field on a created payment link — the API itself
   *  has no other reason to know where apps/web is hosted, and no route
   *  redirects there. Default matches Vite's own default dev port. */
  checkoutBaseUrl: string;
  /** How long a payment link stays 'reserved' (claimed by an in-flight pay
   *  attempt) before it self-expires back to claimable, closing the gap
   *  between claim and finalize without a sweep job. */
  paymentLinkReservationTimeoutSeconds: number;

  /** Base64-encoded 32 raw bytes, the single application-level AES-256-GCM
   *  key `webhooks/secretCrypto.ts` uses to encrypt/decrypt
   *  `webhook_endpoints.secret_ciphertext`. Required when NODE_ENV=production;
   *  elsewhere an unset value falls back to DEV_FALLBACK_WEBHOOK_KEY_B64, a
   *  fixed key that must never protect real secrets. `loadConfig` decodes and validates the length,
   *  failing boot on a missing or malformed value rather than accepting
   *  garbage and failing later at first-delivery time. Callers pass
   *  `Buffer.from(config.webhookSecretEncryptionKey, "base64")` to
   *  `encryptSecret`/`decryptSecret`, which take a `Buffer` key. */
  webhookSecretEncryptionKey: string;
  /** Terminal-failure threshold for a single webhook_deliveries row — the
   *  attempt at which status flips from 'pending' to 'exhausted' instead of
   *  scheduling another retry. */
  webhookMaxAttempts: number;
  /** Exponential backoff base (attempt 1's delay), milliseconds. */
  webhookBackoffBaseMs: number;
  /** Exponential backoff cap — no retry ever waits longer than this,
   *  milliseconds. */
  webhookBackoffCapMs: number;
  /** How often the dispatcher's poll-fallback timer runs a dispatch pass,
   *  independent of LISTEN/NOTIFY — the safety net that guarantees no event
   *  is stuck forever even if a NOTIFY is missed. */
  webhookPollIntervalMs: number;
  /** Per-delivery-attempt HTTP timeout passed to the transport, milliseconds. */
  webhookRequestTimeoutMs: number;
  /** Lets webhooks reach loopback/private addresses, for a merchant's
   *  receiver on localhost during development. Defaults to true outside
   *  production and false in production, where it would let any merchant
   *  make this server call its own internal network (settlement, Postgres,
   *  cloud metadata). */
  webhookAllowPrivateTargets: boolean;

  /** Shared secret the acquirer signs its async callbacks with
   *  (routes/acquirerCallbacks.ts). Platform-level, not per-merchant —
   *  unlike webhookSecretEncryptionKey, there is exactly one acquirer
   *  relationship, not one secret per registered endpoint. Every callback
   *  must be signed with it; while it is empty (allowed outside production)
   *  every callback is rejected. */
  acquirerCallbackSigningSecret: string;
}

function parseNodeEnv(value: string | undefined): Config["nodeEnv"] {
  if (value === "production" || value === "test" || value === "development") {
    return value;
  }
  return "development";
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`loadConfig: expected an integer, got "${value}"`);
  }
  return parsed;
}

function parseFloatEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`loadConfig: expected a number, got "${value}"`);
  }
  return parsed;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

/** Used only when NODE_ENV !== 'production' and WEBHOOK_SECRET_ENCRYPTION_KEY
 *  is unset. Fixed rather than random so the seed and the API, which run as
 *  separate processes, encrypt and decrypt with the same key. The text is
 *  exactly 32 bytes, the AES-256 key length parseWebhookSecretEncryptionKey
 *  requires. */
const DEV_FALLBACK_WEBHOOK_KEY_B64 = Buffer.from("filspay-dev-only-webhook-key-32b").toString("base64");

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Validates WEBHOOK_SECRET_ENCRYPTION_KEY decodes to exactly 32 raw bytes,
 *  failing fast at boot (same posture as DATABASE_URL) rather than
 *  accepting a missing/malformed key and only discovering the problem at
 *  first-delivery time. Returns the original base64 string unchanged — the
 *  Config field stays base64-encoded; callers decode to a Buffer at the
 *  point of use. */
function parseWebhookSecretEncryptionKey(value: string | undefined): string {
  if (!value) {
    throw new Error("loadConfig: WEBHOOK_SECRET_ENCRYPTION_KEY environment variable is not set");
  }
  if (!BASE64_RE.test(value)) {
    throw new Error("loadConfig: WEBHOOK_SECRET_ENCRYPTION_KEY is not valid base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error(
      `loadConfig: WEBHOOK_SECRET_ENCRYPTION_KEY must base64-decode to exactly 32 bytes, got ${decoded.length}`,
    );
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("loadConfig: DATABASE_URL environment variable is not set");
  }

  const nodeEnv = parseNodeEnv(env.NODE_ENV);

  const settlementInternalToken = env.SETTLEMENT_INTERNAL_TOKEN ?? "";
  if (nodeEnv === "production" && settlementInternalToken === "") {
    throw new Error("loadConfig: SETTLEMENT_INTERNAL_TOKEN is required when NODE_ENV=production");
  }

  const otpDevExpose = parseBoolEnv(env.OTP_DEV_EXPOSE, false);
  if (nodeEnv === "production" && otpDevExpose) {
    throw new Error("loadConfig: OTP_DEV_EXPOSE must not be enabled when NODE_ENV=production");
  }

  const acquirerCallbackSigningSecret = env.ACQUIRER_CALLBACK_SIGNING_SECRET ?? "";
  if (nodeEnv === "production" && acquirerCallbackSigningSecret === "") {
    throw new Error("loadConfig: ACQUIRER_CALLBACK_SIGNING_SECRET is required when NODE_ENV=production");
  }

  // Every payment link's `url` is built from this, and customers open it.
  // The localhost default is only for development.
  const checkoutBaseUrl = env.CHECKOUT_BASE_URL ?? (nodeEnv === "production" ? "" : "http://localhost:5173");
  if (nodeEnv === "production" && !checkoutBaseUrl.startsWith("https://")) {
    throw new Error("loadConfig: CHECKOUT_BASE_URL must be set to an https:// URL when NODE_ENV=production");
  }

  return {
    nodeEnv,
    port: parseIntEnv(env.PORT, 3000),
    databaseUrl,

    pgPoolMax: parseIntEnv(env.PG_POOL_MAX, 5),
    pgPoolMin: parseIntEnv(env.PG_POOL_MIN, 0),
    pgPoolIdleTimeoutMs: parseIntEnv(env.PG_POOL_IDLE_TIMEOUT_MS, 30_000),
    pgPoolConnectionTimeoutMs: parseIntEnv(env.PG_POOL_CONNECTION_TIMEOUT_MS, 5_000),

    sessionTtlHours: parseIntEnv(env.SESSION_TTL_HOURS, 12),
    pendingSessionTtlMinutes: parseIntEnv(env.PENDING_SESSION_TTL_MINUTES, 10),
    otpTtlMinutes: parseIntEnv(env.OTP_TTL_MINUTES, 5),
    otpCodeLength: parseIntEnv(env.OTP_CODE_LENGTH, 6),
    otpMaxAttempts: parseIntEnv(env.OTP_MAX_ATTEMPTS, 5),
    otpDevExpose,
    otpLogCode: parseBoolEnv(env.OTP_LOG_CODE, false),

    smtpHost: env.SMTP_HOST ?? "",
    smtpPort: parseIntEnv(env.SMTP_PORT, 587),
    smtpUser: env.SMTP_USER ?? "",
    smtpPass: env.SMTP_PASS ?? "",
    smtpFrom: env.SMTP_FROM ?? "",
    resendApiKey: env.RESEND_API_KEY ?? "",
    otpEmailOverride: env.OTP_EMAIL_OVERRIDE ?? "",
    otpLogMerchantUserIds: (env.OTP_LOG_MERCHANT_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    otpLogAdminUserIds: (env.OTP_LOG_ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),

    argon2MemoryKib: parseIntEnv(env.ARGON2_MEMORY_KIB, 19_456),
    argon2TimeCost: parseIntEnv(env.ARGON2_TIME_COST, 2),
    argon2Parallelism: parseIntEnv(env.ARGON2_PARALLELISM, 1),

    kycUploadDir: env.KYC_UPLOAD_DIR ?? "./data/kyc",
    kycMaxFileSizeBytes: parseIntEnv(env.KYC_MAX_FILE_SIZE_BYTES, 8_388_608),

    acquirerLatencyMinMs: parseIntEnv(env.ACQUIRER_LATENCY_MIN_MS, 100),
    acquirerLatencyMaxMs: parseIntEnv(env.ACQUIRER_LATENCY_MAX_MS, 400),
    acquirerFailureRate: parseFloatEnv(env.ACQUIRER_FAILURE_RATE, 0.02),
    acquirerRngSeed:
      env.ACQUIRER_RNG_SEED !== undefined && env.ACQUIRER_RNG_SEED !== ""
        ? parseIntEnv(env.ACQUIRER_RNG_SEED, 0)
        : null,

    cookieName: env.COOKIE_NAME ?? "fp_sid",
    cookieSecure: parseBoolEnv(env.COOKIE_SECURE, nodeEnv === "production"),

    adminCookieName: env.ADMIN_COOKIE_NAME ?? "fp_admin_sid",
    adminSessionTtlHours: parseIntEnv(env.ADMIN_SESSION_TTL_HOURS, 8),
    adminPendingSessionTtlMinutes: parseIntEnv(env.ADMIN_PENDING_SESSION_TTL_MINUTES, 10),
    adminOtpTtlMinutes: parseIntEnv(env.ADMIN_OTP_TTL_MINUTES, 5),
    adminOtpCodeLength: parseIntEnv(env.ADMIN_OTP_CODE_LENGTH, 6),
    adminOtpMaxAttempts: parseIntEnv(env.ADMIN_OTP_MAX_ATTEMPTS, 5),

    impersonationCookieName: env.IMPERSONATION_COOKIE_NAME ?? "fp_impersonation",
    impersonationTtlMinutes: parseIntEnv(env.IMPERSONATION_TTL_MINUTES, 15),

    settlementInternalUrl: env.SETTLEMENT_INTERNAL_URL ?? "http://settlement:8091",
    settlementInternalToken,
    settlementInternalRequestTimeoutMs: parseIntEnv(env.SETTLEMENT_INTERNAL_REQUEST_TIMEOUT_MS, 30_000),

    checkoutBaseUrl,
    paymentLinkReservationTimeoutSeconds: parseIntEnv(env.PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS, 60),

    webhookSecretEncryptionKey: parseWebhookSecretEncryptionKey(
      env.WEBHOOK_SECRET_ENCRYPTION_KEY || (nodeEnv !== "production" ? DEV_FALLBACK_WEBHOOK_KEY_B64 : undefined),
    ),
    webhookMaxAttempts: parseIntEnv(env.WEBHOOK_MAX_ATTEMPTS, 8),
    webhookBackoffBaseMs: parseIntEnv(env.WEBHOOK_BACKOFF_BASE_MS, 30_000),
    webhookBackoffCapMs: parseIntEnv(env.WEBHOOK_BACKOFF_CAP_MS, 21_600_000),
    webhookPollIntervalMs: parseIntEnv(env.WEBHOOK_POLL_INTERVAL_MS, 5_000),
    webhookRequestTimeoutMs: parseIntEnv(env.WEBHOOK_REQUEST_TIMEOUT_MS, 10_000),
    webhookAllowPrivateTargets: parseBoolEnv(env.WEBHOOK_ALLOW_PRIVATE_TARGETS, nodeEnv !== "production"),

    acquirerCallbackSigningSecret,
  };
}
