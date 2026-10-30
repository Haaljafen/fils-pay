package settlement

import (
	"context"
	"testing"
	"time"
)

// A batch that has been paid out is history: net_payout_fils is what left the
// platform. RecalculateMDR used to rewrite it (status <> 'open'), posted an
// adjustment that no later payout nets, and left the batch row, the ledger and
// the balance cache disagreeing.
func TestRecalculateMDR_LeavesPaidBatchesAlone(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const originalMdrBps = 250
	merchantID := insertActiveMerchant(t, pool, originalMdrBps)

	businessDate := time.Date(2026, 4, 12, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, originalMdrBps, 40_000, start.Add(time.Hour))

	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := PayoutBatch(ctx, pool, closed.BatchID); err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 400 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("update mdr_bps: %v", err)
	}

	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if result.BatchesConsidered != 0 || len(result.Adjusted) != 0 {
		t.Fatalf("considered=%d adjusted=%d, want 0/0 for a paid batch", result.BatchesConsidered, len(result.Adjusted))
	}

	var fee, net int64
	if err := pool.QueryRow(ctx, `SELECT fee_fils, net_payout_fils FROM settlement_batches WHERE id = $1`, closed.BatchID).Scan(&fee, &net); err != nil {
		t.Fatalf("read batch: %v", err)
	}
	if fee != int64(closed.FeeFils) || net != int64(closed.NetPayoutFils) {
		t.Errorf("paid batch rewritten: fee=%d net=%d, want %d/%d", fee, net, closed.FeeFils, closed.NetPayoutFils)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM ledger_entries WHERE merchant_id = $1 AND description = 'MDR recalculation adjustment'`, merchantID); n != 0 {
		t.Errorf("posted %d adjustment legs against a paid batch, want 0", n)
	}
}

// The recalculation must price each event at the rate that was in effect when
// it happened (the merchant's fee schedule), exactly as CloseBatch did, not at
// today's flat merchants.mdr_bps.
func TestRecalculateMDR_UsesRateInEffectAtEventTime(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const baseMdrBps = 250
	merchantID := insertActiveMerchant(t, pool, baseMdrBps)

	businessDate := time.Date(2026, 4, 13, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	if _, err := pool.Exec(ctx, `
		INSERT INTO fee_schedules (merchant_id, effective_from, mdr_bps) VALUES ($1, $2, 180)
	`, merchantID, start.Add(-24*time.Hour)); err != nil {
		t.Fatalf("insert fee schedule: %v", err)
	}
	insertCaptureEvent(t, pool, merchantID, 180, 50_000, start.Add(time.Hour))

	if _, err := CloseBatch(ctx, pool, merchantID, businessDate); err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	// An unrelated base-rate change must not re-price an event the schedule covers.
	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 400 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("update mdr_bps: %v", err)
	}

	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if len(result.Adjusted) != 0 {
		t.Fatalf("adjusted %d batch(es) at the flat 400 bps; the scheduled 180 bps was in effect, want 0", len(result.Adjusted))
	}
}
