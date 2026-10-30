import type { Pool } from "pg";
import { derivePublicStatus } from "./status.js";

interface PublicPaymentLinkRow {
  token: string;
  amount_fils: string | number;
  currency: string;
  reference: string | null;
  description: string | null;
  status: string;
  expires_at: Date;
  reserved_at: Date | null;
  merchant_display_name: string;
}

/** Public shape. Contains nothing that identifies or authenticates the merchant beyond its display name. */
export interface PublicPaymentLinkDto {
  token: string;
  amountFils: number;
  currency: string;
  merchantDisplayName: string;
  reference: string | null;
  description: string | null;
  status: string;
  expiresAt: string;
}

/**
 * `GET /v1/payment-links/:token` — public, unauthenticated.
 *
 * Never reads api_keys. This used to return the merchant's newest live API
 * key's key_prefix (the first 16 characters of the raw secret key) and its
 * key_hash (the sha256 the API authenticates against) to anyone holding a
 * checkout link. Nothing in the checkout page used either value.
 */
export async function getPublicPaymentLink(
  pool: Pool,
  token: string,
  reservationTimeoutSeconds: number,
): Promise<PublicPaymentLinkDto | null> {
  const result = await pool.query<PublicPaymentLinkRow>(
    `SELECT pl.token, pl.amount_fils, pl.currency, pl.reference, pl.description,
            pl.status, pl.expires_at, pl.reserved_at, m.display_name AS merchant_display_name
       FROM payment_links pl
       JOIN merchants m ON m.id = pl.merchant_id
      WHERE pl.token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;
  return toPublicPaymentLinkDto(row, reservationTimeoutSeconds);
}

/** Builds the public DTO field by field, so a column added to the query can never reach a customer by accident. */
export function toPublicPaymentLinkDto(
  row: PublicPaymentLinkRow,
  reservationTimeoutSeconds: number,
): PublicPaymentLinkDto {
  return {
    token: row.token,
    amountFils: Number(row.amount_fils),
    currency: row.currency,
    merchantDisplayName: row.merchant_display_name,
    reference: row.reference,
    description: row.description,
    // YA: same helper as pay.ts so the two never disagree. correct
    status: derivePublicStatus(
      { status: row.status, expiresAt: row.expires_at, reservedAt: row.reserved_at },
      reservationTimeoutSeconds,
    ),
    expiresAt: row.expires_at.toISOString(),
  };
}
