import type { Pool } from "pg";
import type { Config } from "../config.js";
import { randomToken } from "../lib/crypto.js";
import { decodeEncryptionKey, encryptSecret } from "./secretCrypto.js";

export interface RotatedWebhookSecret {
  id: string;
  secretPrefix: string;
  /** Returned once, here. It is stored encrypted and never returned again. */
  secret: string;
}

/**
 * `POST /v1/merchants/:merchantId/webhook-endpoints/:id/rotate-secret`.
 * Replaces the signing secret. Deliveries made after this call are signed with the new
 * secret only, so the merchant must update their receiver first or in the same moment.
 * Returns null when the endpoint does not belong to this merchant.
 */
export async function rotateWebhookSecret(
  pool: Pool,
  config: Pick<Config, "webhookSecretEncryptionKey">,
  input: { merchantId: string; id: string },
): Promise<RotatedWebhookSecret | null> {
  const rawSecret = `whsec_${randomToken(24)}`;
  const secretPrefix = rawSecret.slice(0, 14);
  const ciphertext = encryptSecret(rawSecret, decodeEncryptionKey(config.webhookSecretEncryptionKey));
  const result = await pool.query<{ id: string }>(
    `UPDATE webhook_endpoints
        SET secret_ciphertext = $3, secret_prefix = $4, updated_at = now()
      WHERE id = $2 AND merchant_id = $1
      RETURNING id`,
    [input.merchantId, input.id, ciphertext, secretPrefix],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, secretPrefix, secret: rawSecret };
}
