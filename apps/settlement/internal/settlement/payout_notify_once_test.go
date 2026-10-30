package settlement

import (
	"context"
	"sync"
	"testing"
	"time"
)

// The daemon tick and a manual `run-batch` can scan at the same moment. Both
// pass the NOT EXISTS guard; before migration 0075 both inserted, and every
// duplicate settlement.paid produced another payout instruction downstream.
func TestEnqueuePayoutNotifications_ConcurrentScansEnqueueOnce(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 4, 14, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, mdrBps, 90_000, start.Add(time.Hour))
	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := PayoutBatch(ctx, pool, closed.BatchID); err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := EnqueuePayoutNotifications(ctx, pool); err != nil {
				t.Errorf("EnqueuePayoutNotifications: %v", err)
			}
		}()
	}
	wg.Wait()

	if n := countRows(t, pool, `SELECT count(*) FROM outbox_events WHERE event_type = 'settlement.paid' AND aggregate_id = $1`, closed.BatchID); n != 1 {
		t.Fatalf("settlement.paid events for the batch = %d, want exactly 1", n)
	}
}
