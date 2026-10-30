package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A capture can land after its own day's batch closed: occurred_at is its
// transaction's start, and the transaction is held across the acquirer call.
// That batch is frozen and re-running its date is a no-op, so the next close
// has to pick the capture up, or the merchant is never paid for it.
func TestCloseBatch_ClaimsCaptureThatMissedItsClosedBatch(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	day1 := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	day2 := day1.AddDate(0, 0, 1)
	_, end1 := BusinessDayWindow(day1)

	first := closeAndPay(t, pool, merchantID, day1)
	if first.GrossFils != 0 {
		t.Fatalf("day 1 gross = %d, want 0 before the late capture", first.GrossFils)
	}

	txnID, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, end1.Add(-time.Second))

	second := closeAndPay(t, pool, merchantID, day2)

	if second.GrossFils != 10000 || second.NetPayoutFils != 9750 {
		t.Errorf("day 2 gross/net = %d/%d, want 10000/9750 (the capture its own batch missed)", second.GrossFils, second.NetPayoutFils)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM transaction_events WHERE transaction_id = $1 AND settlement_batch_id = $2`, txnID, second.BatchID); n != 1 {
		t.Errorf("late capture events claimed by day 2 = %d, want 1", n)
	}
	if got := ledgerPayable(t, pool, merchantID); got != 0 {
		t.Errorf("merchant_payable after day 2 = %d, want 0: everything captured has been paid", got)
	}
}

// A day whose batch never ran keeps its own batch: the capture is not moved
// into a later day's figures when its own day can still be closed.
func TestRunDailyBatch_ClosesEarlierDayThatNeverRan(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	day1 := time.Date(2026, 5, 4, 0, 0, 0, 0, time.UTC)
	day2 := day1.AddDate(0, 0, 1)
	start1, _ := BusinessDayWindow(day1)
	start2, _ := BusinessDayWindow(day2)

	// The merchant is suspended across day 1's run, so no batch is created.
	setMerchantStatus(t, pool, merchantID, "suspended")
	insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, start1.Add(time.Hour))
	if _, err := RunDailyBatch(ctx, pool, day1, &merchantID); err != nil {
		t.Fatalf("RunDailyBatch day 1: %v", err)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM settlement_batches WHERE merchant_id = $1`, merchantID); n != 0 {
		t.Fatalf("batches while suspended = %d, want 0", n)
	}

	setMerchantStatus(t, pool, merchantID, "active")
	insertCaptureEvent(t, pool, merchantID, mdrBps, 4000, start2.Add(time.Hour))
	if _, err := RunDailyBatch(ctx, pool, day2, &merchantID); err != nil {
		t.Fatalf("RunDailyBatch day 2: %v", err)
	}

	var gross1, gross2 int64
	var status1 string
	if err := pool.QueryRow(ctx, `SELECT gross_fils, status FROM settlement_batches WHERE merchant_id = $1 AND batch_date = $2`, merchantID, day1).Scan(&gross1, &status1); err != nil {
		t.Fatalf("read day 1 batch: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT gross_fils FROM settlement_batches WHERE merchant_id = $1 AND batch_date = $2`, merchantID, day2).Scan(&gross2); err != nil {
		t.Fatalf("read day 2 batch: %v", err)
	}
	if gross1 != 10000 || status1 != "paid" {
		t.Errorf("day 1 batch = %d/%s, want 10000/paid", gross1, status1)
	}
	if gross2 != 4000 {
		t.Errorf("day 2 gross = %d, want 4000 (day 1's capture stays in day 1's batch)", gross2)
	}
	if got := ledgerPayable(t, pool, merchantID); got != 0 {
		t.Errorf("merchant_payable = %d, want 0", got)
	}

	// Running the pass again changes nothing.
	legs := countRows(t, pool, `SELECT count(*) FROM ledger_entries WHERE merchant_id = $1`, merchantID)
	if _, err := RunDailyBatch(ctx, pool, day2, &merchantID); err != nil {
		t.Fatalf("RunDailyBatch re-run: %v", err)
	}
	if after := countRows(t, pool, `SELECT count(*) FROM ledger_entries WHERE merchant_id = $1`, merchantID); after != legs {
		t.Errorf("re-run posted ledger legs: %d -> %d", legs, after)
	}
}

// A merchant still ineligible is left alone: its pending days wait.
func TestRunDailyBatch_SkipsCatchUpWhileIneligible(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	day1 := time.Date(2026, 5, 8, 0, 0, 0, 0, time.UTC)
	start1, _ := BusinessDayWindow(day1)

	insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, start1.Add(time.Hour))
	setMerchantStatus(t, pool, merchantID, "suspended")
	if _, err := RunDailyBatch(ctx, pool, day1.AddDate(0, 0, 1), &merchantID); err != nil {
		t.Fatalf("RunDailyBatch: %v", err)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM settlement_batches WHERE merchant_id = $1`, merchantID); n != 0 {
		t.Errorf("batches for a suspended merchant = %d, want 0", n)
	}
}

func setMerchantStatus(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, status string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `UPDATE merchants SET status = $2 WHERE id = $1`, merchantID, status); err != nil {
		t.Fatalf("setMerchantStatus(%s): %v", status, err)
	}
}
