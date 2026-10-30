package settlement

import (
	"context"
	"testing"
)

// The lifetime counter crosses the 2,000,000,000-fil tier threshold right
// next to the 32-bit limit (2,147,483,647). It must keep counting exactly
// past that limit, and the tier must stay granted.
func TestRecordPlatformProcessedVolume_PastThe32BitLimit(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `UPDATE platform_stats SET total_processed_fils = 2100000000 WHERE id = 1`); err != nil {
		t.Fatalf("seed counter: %v", err)
	}

	current, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil {
		t.Fatalf("ReadAndLockPlatformProcessedFils: %v", err)
	}
	if err := RecordPlatformProcessedVolume(ctx, tx, current, 100_000_000); err != nil {
		t.Fatalf("RecordPlatformProcessedVolume: %v", err)
	}

	var total int64
	if err := tx.QueryRow(ctx, `SELECT total_processed_fils FROM platform_stats WHERE id = 1`).Scan(&total); err != nil {
		t.Fatalf("read back total: %v", err)
	}
	if total != 2_200_000_000 {
		t.Fatalf("total_processed_fils = %d, want 2200000000", total)
	}

	after, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if bonus := VolumeTierMdrBonusBps(after); bonus != 15 {
		t.Fatalf("tier bonus at %d fils = %d bps, want 15", total, bonus)
	}
}
