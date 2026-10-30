package settlement

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// ReadAndLockPlatformProcessedFils reads the platform-wide lifetime
// processed-volume counter with a row lock, so two batches closing
// concurrently for different merchants serialize on this single shared
// counter row instead of racing a lost update. Returns the current value.
func ReadAndLockPlatformProcessedFils(ctx context.Context, tx pgx.Tx) (int64, error) {
	var current int64
	err := tx.QueryRow(ctx, `
		SELECT total_processed_fils FROM platform_stats WHERE id = 1 FOR UPDATE
	`).Scan(&current)
	return current, err
}

// RecordPlatformProcessedVolume adds this batch's gross fils to the
// already-locked running total and writes the result back. The addition
// happens here rather than as SQL `SET x = x + $2` so the value written is
// derived from exactly the value this batch's fee calculation read.
// int64 throughout (BIGINT column, migration 0074): the counter passes the
// 32-bit limit just after the tier threshold.
func RecordPlatformProcessedVolume(ctx context.Context, tx pgx.Tx, current int64, batchGrossFils int64) error {
	_, err := tx.Exec(ctx, `
		UPDATE platform_stats SET total_processed_fils = $1, updated_at = now() WHERE id = 1
	`, current+batchGrossFils)
	return err
}

// ReadVolumeTierEnabled reports whether the volume-tier discount is switched
// on (platform_stats.volume_tier_enabled, migration 0075). It is off unless
// finance has approved it; apps/api reads the same column, so capture and
// settlement always agree.
func ReadVolumeTierEnabled(ctx context.Context, tx pgx.Tx) (bool, error) {
	var enabled bool
	err := tx.QueryRow(ctx, `SELECT volume_tier_enabled FROM platform_stats WHERE id = 1`).Scan(&enabled)
	return enabled, err
}

// VolumeTierMdrBonusBps returns the platform-wide MDR reduction (in basis
// points) every merchant's effective rate receives once lifetime processed
// volume reaches the platform's volume-tier threshold — a loyalty-style
// discount for the platform having processed enough real activity to have
// earned better acquirer-side economics to pass through.
func VolumeTierMdrBonusBps(totalProcessedFils int64) int64 {
	const volumeTierThresholdFils int64 = 2_000_000_000 // 2,000,000.000 BD
	const volumeTierBonusBps int64 = 15                 // 0.15%
	if totalProcessedFils >= volumeTierThresholdFils {
		return volumeTierBonusBps
	}
	return 0
}
