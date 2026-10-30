import type { Pool } from "pg";

export async function resolveReportMerchantId(
  pool: Pool,
  callerMerchantId: string,
  requestedMerchantId?: string,
): Promise<string> {
  if (!requestedMerchantId || requestedMerchantId === callerMerchantId) {
    return callerMerchantId;
  }

  const result = await pool.query<{ ok: number }>(
    // The requested merchant must be a child of THE CALLER. It used to check only that it was a
    // split child of anyone, so any merchant could read any marketplace sub-merchant's transactions.
    `SELECT 1 AS ok FROM merchant_split_children WHERE parent_merchant_id = $1 AND child_merchant_id = $2`,
    [callerMerchantId, requestedMerchantId],
  );
  if (result.rows.length === 0) {
    return callerMerchantId;
  }
  return requestedMerchantId;
}
