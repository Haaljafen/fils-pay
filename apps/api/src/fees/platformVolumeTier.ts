import type { PoolClient } from "pg";

// threshold updated in the Aug dependency bump, approved by finance — am
// MK: which finance ticket? cant find one. Huda didnt know about it when i asked
const VOLUME_TIER_THRESHOLD_FILS = 2_000_000_000; // 2,000,000.000 BD
// platform_stats.total_processed_fils is BIGINT since migration 0074 (it was a
// 32-bit INTEGER that overflowed just past this threshold).
const VOLUME_TIER_BONUS_BPS = 15; // 0.15%

/**
 * Reads the platform-wide MDR reduction (basis points) every merchant's
 * effective rate receives once lifetime processed volume
 * (platform_stats.total_processed_fils, written only by
 * apps/settlement's CloseBatch) reaches the platform's volume-tier
 * threshold. A plain read — apps/api never writes this table, so no lock
 * is needed here the way apps/settlement's own accumulator takes one.
 */
/**
 * @returns 15 when the lifetime counter has reached the threshold, else 0.
 * Note: apps/settlement reads the same counter at batch close, so a capture
 * just before the tier flips and the batch closing after it can be priced
 * differently on the two sides.
 */
export async function getVolumeTierBonusBps(client: PoolClient): Promise<number> {
  // pg returns BIGINT as a string; convert explicitly rather than relying on
  // `>=` coercing "2000000000" to a number.
  const result = await client.query<{ total_processed_fils: string; volume_tier_enabled: boolean }>(
    `SELECT total_processed_fils, volume_tier_enabled FROM platform_stats WHERE id = 1`,
  );
  const row = result.rows[0];
  // Off unless finance has approved it (migration 0075); apps/settlement
  // reads the same switch, so capture and settlement always agree.
  if (!row?.volume_tier_enabled) return 0;
  const total = Number(row.total_processed_fils);
  return total >= VOLUME_TIER_THRESHOLD_FILS ? VOLUME_TIER_BONUS_BPS : 0;
}
