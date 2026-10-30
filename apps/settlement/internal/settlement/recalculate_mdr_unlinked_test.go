package settlement

import (
	"context"
	"testing"
	"time"
)

// A closed batch whose capture events are not linked to it (settlement_batch_id
// NULL) has a gross on its row but no events to price. Re-deriving its fee used
// to sum zero events, get a fee of 0 and credit the old fee back to the merchant.
// RecalculateMDR must refuse instead, and leave the batch and ledger untouched.
func TestRecalculateMDR_RefusesBatchWhoseEventsAreNotLinked(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 4, 14, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, mdrBps, 40_000, start.Add(time.Hour))

	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE transaction_events SET settlement_batch_id = NULL WHERE settlement_batch_id = $1`, closed.BatchID); err != nil {
		t.Fatalf("unlink events: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 400 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("update mdr_bps: %v", err)
	}

	from, to := recalcWindow(businessDate)
	if _, err := RecalculateMDR(ctx, pool, merchantID, from, to); err == nil {
		t.Fatalf("RecalculateMDR succeeded on a batch with no linked events; want an error")
	}

	var fee int64
	if err := pool.QueryRow(ctx, `SELECT fee_fils FROM settlement_batches WHERE id = $1`, closed.BatchID).Scan(&fee); err != nil {
		t.Fatalf("read batch: %v", err)
	}
	if fee != int64(closed.FeeFils) {
		t.Errorf("fee rewritten to %d, want %d unchanged", fee, closed.FeeFils)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM ledger_entries WHERE merchant_id = $1 AND description = 'MDR recalculation adjustment'`, merchantID); n != 0 {
		t.Errorf("posted %d adjustment legs for a batch it refused, want 0", n)
	}
}
