import { createHmac } from "node:crypto";
import { timingSafeEqualHex } from "../lib/crypto.js";

/** Verifies the signature on an inbound acquirer callback. Every callback must
 *  be signed: this endpoint has no other authentication. */

interface ParsedAcquirerSignatureHeader {
  timestamp: number;
  signature: string;
}

function parseAcquirerSignatureHeader(header: string): ParsedAcquirerSignatureHeader | null {
  let timestampStr: string | null = null;
  let signature: string | null = null;

  for (const part of header.split(",")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (key === "t") timestampStr = value;
    else if (key === "v1") signature = value;
  }

  if (!timestampStr || !signature) return null;
  if (!/^\d+$/.test(timestampStr)) return null;

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return null;

  return { timestamp, signature };
}

export type VerifyAcquirerCallbackFailureReason =
  | "secret_not_configured"
  | "missing_header"
  | "malformed_header"
  | "signature_mismatch"
  | "timestamp_out_of_tolerance";

export interface VerifyAcquirerCallbackResult {
  valid: boolean;
  reason?: VerifyAcquirerCallbackFailureReason;
}

/** Same window webhooks/sign.ts uses for outbound signatures. */
const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * `rawBody` must be the exact bytes the acquirer sent. Re-serialising the
 * parsed body changes key order and whitespace, so a genuine callback could
 * fail the check; the signature is over the bytes, as the acquirer signed them.
 */
export function verifyAcquirerCallbackSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  options?: { toleranceSeconds?: number; now?: number },
): VerifyAcquirerCallbackResult {
  // An empty HMAC key is public knowledge: anyone could sign with it.
  if (secret === "") return { valid: false, reason: "secret_not_configured" };
  if (!header) return { valid: false, reason: "missing_header" };

  const parsed = parseAcquirerSignatureHeader(header);
  if (!parsed) return { valid: false, reason: "malformed_header" };

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest("hex");

  if (!timingSafeEqualHex(expected, parsed.signature)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  const now = options?.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { valid: false, reason: "timestamp_out_of_tolerance" };
  }

  return { valid: true };
}
