package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/filspay/settlement/internal/money"
)

// setPlatformStats puts the counter (and, when the column exists, the tier
// switch) in a known state and restores the fresh-seed state afterwards.
func setPlatformStats(t *testing.T, total int64, tierEnabled *bool) {
	t.Helper()
	pool := mustPool(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE platform_stats SET total_processed_fils = $1 WHERE id = 1`, total); err != nil {
		t.Fatalf("set counter: %v", err)
	}
	if tierEnabled != nil {
		if _, err := pool.Exec(ctx, `UPDATE platform_stats SET volume_tier_enabled = $1 WHERE id = 1`, *tierEnabled); err != nil {
			t.Fatalf("set tier switch: %v", err)
		}
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `UPDATE platform_stats SET total_processed_fils = 0 WHERE id = 1`) //nolint:errcheck
		if tierEnabled != nil {
			pool.Exec(ctx, `UPDATE platform_stats SET volume_tier_enabled = false WHERE id = 1`) //nolint:errcheck
		}
	})
}

func closeOneCaptureBatch(t *testing.T, amount money.Fils, mdrBps int64) BatchResult {
	t.Helper()
	pool := mustPool(t)
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, mdrBps, amount, start.Add(time.Hour))

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	return result
}

// The volume-tier discount was never approved by finance, so past the
// threshold the merchant must still pay the full contracted MDR unless the
// tier has been switched on explicitly.
func TestCloseBatch_VolumeTierOffByDefault(t *testing.T) {
	setPlatformStats(t, 2_200_000_000, nil)
	result := closeOneCaptureBatch(t, 100_000, 250)
	if want := money.ApplyRateFils(100_000, 250); result.FeeFils != want {
		t.Fatalf("FeeFils = %d, want %d (full 2.50%%, tier not enabled)", result.FeeFils, want)
	}
}

func TestCloseBatch_VolumeTierAppliesOnceEnabled(t *testing.T) {
	enabled := true
	setPlatformStats(t, 2_200_000_000, &enabled)
	result := closeOneCaptureBatch(t, 100_000, 250)
	if want := money.ApplyRateFils(100_000, 250-15); result.FeeFils != want {
		t.Fatalf("FeeFils = %d, want %d (2.35%% with the tier enabled)", result.FeeFils, want)
	}
}
