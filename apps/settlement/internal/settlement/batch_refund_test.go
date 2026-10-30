package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
	"github.com/filspay/settlement/internal/splits"
)

// insertRefund records a succeeded refund the way processRefund.ts does: the
// refunds row plus the reversal's ledger legs. refunded_fils is not touched;
// nothing CloseBatch reads depends on it.
func insertRefund(t *testing.T, pool *pgxpool.Pool, merchantID, txnID uuid.UUID, amountFils, feeReversedFils money.Fils, status string, occurredAt time.Time) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	var refundID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status, acquirer_reference, reason, created_by_type, created_by_id, occurred_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'test', 'merchant_session', $7, $8)
		RETURNING id
	`, txnID, merchantID, int64(amountFils), int64(feeReversedFils), status, "acq-refund-"+uuid.New().String(), uuid.New(), occurredAt).Scan(&refundID)
	if err != nil {
		t.Fatalf("insertRefund: insert refund: %v", err)
	}
	if status != "succeeded" {
		return refundID
	}

	groupID := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO ledger_entries
		  (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES
		  ($1, $2, $3, 'merchant_payable',     'debit',  $4, $5, 'refund: gross'),
		  ($1, $2, $3, 'card_scheme_clearing', 'credit', $4, $5, 'refund: gross')
	`, groupID, merchantID, txnID, int64(amountFils), occurredAt)
	if err != nil {
		t.Fatalf("insertRefund: insert gross legs: %v", err)
	}
	if feeReversedFils > 0 {
		_, err = pool.Exec(ctx, `
			INSERT INTO ledger_entries
			  (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
			VALUES
			  ($1, $2, $3, 'platform_fee_revenue', 'debit',  $4, $5, 'refund: MDR fee reversal'),
			  ($1, $2, $3, 'merchant_payable',     'credit', $4, $5, 'refund: MDR fee reversal')
		`, groupID, merchantID, txnID, int64(feeReversedFils), occurredAt)
		if err != nil {
			t.Fatalf("insertRefund: insert fee legs: %v", err)
		}
	}
	return refundID
}

type batchRefundFigures struct {
	refund, feeReversed, carryIn, carryOut, net int64
}

func readBatchRefundFigures(t *testing.T, pool *pgxpool.Pool, batchID uuid.UUID) batchRefundFigures {
	t.Helper()
	var f batchRefundFigures
	err := pool.QueryRow(context.Background(), `
		SELECT refund_fils, fee_reversed_fils, carry_in_fils, carry_out_fils, net_payout_fils
		  FROM settlement_batches WHERE id = $1
	`, batchID).Scan(&f.refund, &f.feeReversed, &f.carryIn, &f.carryOut, &f.net)
	if err != nil {
		t.Fatalf("readBatchRefundFigures: %v", err)
	}
	return f
}

func refundBatchID(t *testing.T, pool *pgxpool.Pool, refundID uuid.UUID) *uuid.UUID {
	t.Helper()
	var batchID *uuid.UUID
	if err := pool.QueryRow(context.Background(), `SELECT settlement_batch_id FROM refunds WHERE id = $1`, refundID).Scan(&batchID); err != nil {
		t.Fatalf("refundBatchID: %v", err)
	}
	return batchID
}

func ledgerPayable(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) int64 {
	t.Helper()
	var balance int64
	err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)
		  FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'
	`, merchantID).Scan(&balance)
	if err != nil {
		t.Fatalf("ledgerPayable: %v", err)
	}
	return balance
}

func cachedPayable(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) int64 {
	t.Helper()
	var balance int64
	err := pool.QueryRow(context.Background(), `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&balance)
	if err != nil {
		t.Fatalf("cachedPayable: %v", err)
	}
	return balance
}

func closeAndPay(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, businessDate time.Time) BatchResult {
	t.Helper()
	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch(%s): %v", businessDate.Format("2006-01-02"), err)
	}
	if _, err := PayoutBatch(context.Background(), pool, result.BatchID); err != nil {
		t.Fatalf("PayoutBatch(%s): %v", businessDate.Format("2006-01-02"), err)
	}
	return result
}

// A partial refund on the same day as the capture comes out of that day's
// payout, net of the fee share it gave back.
func TestCloseBatch_PartialRefundReducesPayout(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	txnID, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, start.Add(time.Hour))
	refundID := insertRefund(t, pool, merchantID, txnID, 2000, 50, "succeeded", start.Add(2*time.Hour))

	result := closeAndPay(t, pool, merchantID, businessDate)

	if result.GrossFils != 10000 || result.FeeFils != 250 {
		t.Errorf("gross/fee = %d/%d, want 10000/250 (a refund does not rewrite what was captured)", result.GrossFils, result.FeeFils)
	}
	if result.NetPayoutFils != 7800 {
		t.Errorf("NetPayoutFils = %d, want 7800 (10000 - 250 - 2000 + 50)", result.NetPayoutFils)
	}
	f := readBatchRefundFigures(t, pool, result.BatchID)
	if f.refund != 2000 || f.feeReversed != 50 || f.carryOut != 0 {
		t.Errorf("batch figures = %+v, want refund 2000, fee reversed 50, no carry", f)
	}
	if got := refundBatchID(t, pool, refundID); got == nil || *got != result.BatchID {
		t.Errorf("refunds.settlement_batch_id = %v, want %s", got, result.BatchID)
	}
	if got := ledgerPayable(t, pool, merchantID); got != 0 {
		t.Errorf("merchant_payable after payout = %d, want 0: the payout must equal what the ledger owes", got)
	}
}

// A refund of money paid out on an earlier day comes out of the later batch.
// When that batch cannot cover it, the payout is zero (never negative) and
// the shortfall comes out of the next batch; the ledger clears exactly.
func TestCloseBatch_NegativeNetCarriesForward(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	day1 := time.Date(2026, 4, 2, 0, 0, 0, 0, time.UTC)
	day2 := day1.AddDate(0, 0, 1)
	day3 := day1.AddDate(0, 0, 2)
	start1, _ := BusinessDayWindow(day1)
	start2, _ := BusinessDayWindow(day2)
	start3, _ := BusinessDayWindow(day3)

	txnID, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, start1.Add(time.Hour))
	closeAndPay(t, pool, merchantID, day1)

	insertRefund(t, pool, merchantID, txnID, 10000, 250, "succeeded", start2.Add(time.Hour))
	second := closeAndPay(t, pool, merchantID, day2)

	if second.NetPayoutFils != 0 {
		t.Errorf("day 2 NetPayoutFils = %d, want 0 (a payout is never negative)", second.NetPayoutFils)
	}
	if f := readBatchRefundFigures(t, pool, second.BatchID); f.carryOut != 9750 {
		t.Errorf("day 2 carry_out_fils = %d, want 9750", f.carryOut)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM ledger_entries WHERE settlement_batch_id = $1`, second.BatchID); n != 0 {
		t.Errorf("day 2 posted %d ledger legs, want 0: nothing was paid", n)
	}
	if got := ledgerPayable(t, pool, merchantID); got != -9750 {
		t.Errorf("merchant_payable after day 2 = %d, want -9750", got)
	}
	if got := cachedPayable(t, pool, merchantID); got != -9750 {
		t.Errorf("cached_payable_fils after day 2 = %d, want -9750 (the cache must agree with the ledger)", got)
	}

	insertCaptureEvent(t, pool, merchantID, mdrBps, 20000, start3.Add(time.Hour))
	third := closeAndPay(t, pool, merchantID, day3)

	if third.NetPayoutFils != 9750 {
		t.Errorf("day 3 NetPayoutFils = %d, want 9750 (19500 less the 9750 carried in)", third.NetPayoutFils)
	}
	if f := readBatchRefundFigures(t, pool, third.BatchID); f.carryIn != 9750 || f.carryOut != 0 {
		t.Errorf("day 3 carry = %+v, want 9750 in, 0 out", f)
	}
	if got := ledgerPayable(t, pool, merchantID); got != 0 {
		t.Errorf("merchant_payable after day 3 = %d, want 0", got)
	}
	if got := cachedPayable(t, pool, merchantID); got != 0 {
		t.Errorf("cached_payable_fils after day 3 = %d, want 0", got)
	}
}

// A shortfall bigger than the next batch rolls on again rather than being
// dropped.
func TestCloseBatch_CarryRollsAcrossSeveralBatches(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	day1 := time.Date(2026, 4, 6, 0, 0, 0, 0, time.UTC)
	day2 := day1.AddDate(0, 0, 1)
	day3 := day1.AddDate(0, 0, 2)
	start1, _ := BusinessDayWindow(day1)
	start2, _ := BusinessDayWindow(day2)
	start3, _ := BusinessDayWindow(day3)

	txnID, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 40000, start1.Add(time.Hour))
	closeAndPay(t, pool, merchantID, day1)

	insertRefund(t, pool, merchantID, txnID, 40000, 1000, "succeeded", start2.Add(time.Hour))
	insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, start2.Add(2*time.Hour))
	second := closeAndPay(t, pool, merchantID, day2)
	if f := readBatchRefundFigures(t, pool, second.BatchID); f.net != 0 || f.carryOut != 29250 {
		t.Errorf("day 2 = %+v, want net 0, carry out 29250", f)
	}

	insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, start3.Add(time.Hour))
	third := closeAndPay(t, pool, merchantID, day3)
	if f := readBatchRefundFigures(t, pool, third.BatchID); f.net != 0 || f.carryIn != 29250 || f.carryOut != 19500 {
		t.Errorf("day 3 = %+v, want net 0, carry in 29250, carry out 19500", f)
	}
	if got := ledgerPayable(t, pool, merchantID); got != -19500 {
		t.Errorf("merchant_payable = %d, want -19500 (equal to the outstanding carry)", got)
	}
}

// Which refunds a batch claims: the merchant's own, succeeded, not already
// batched, up to the end of the window. A refund from before the window that
// nobody claimed still counts: processRefund holds its transaction across the
// acquirer call and occurred_at is that transaction's start, so one begun just
// before midnight can commit after that day's batch has closed. Claiming only
// inside the window would pay that money out and never take it back.
func TestCloseBatch_WhichRefundsAreClaimed(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	otherMerchant := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 4, 10, 0, 0, 0, 0, time.UTC)
	start, end := BusinessDayWindow(businessDate)

	txnID, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 50000, start.Add(-48*time.Hour))
	otherTxn, _ := insertCaptureEvent(t, pool, otherMerchant, mdrBps, 50000, start.Add(-48*time.Hour))

	inWindow := insertRefund(t, pool, merchantID, txnID, 1000, 25, "succeeded", start.Add(time.Hour))
	straggler := insertRefund(t, pool, merchantID, txnID, 2000, 50, "succeeded", start.Add(-time.Minute))
	failed := insertRefund(t, pool, merchantID, txnID, 3000, 0, "failed", start.Add(time.Hour))
	later := insertRefund(t, pool, merchantID, txnID, 4000, 100, "succeeded", end.Add(time.Minute))
	foreign := insertRefund(t, pool, otherMerchant, otherTxn, 5000, 125, "succeeded", start.Add(time.Hour))

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	f := readBatchRefundFigures(t, pool, result.BatchID)
	if f.refund != 3000 || f.feeReversed != 75 {
		t.Errorf("batch refund/fee reversed = %d/%d, want 3000/75", f.refund, f.feeReversed)
	}
	for name, id := range map[string]uuid.UUID{"in window": inWindow, "straggler": straggler} {
		if got := refundBatchID(t, pool, id); got == nil || *got != result.BatchID {
			t.Errorf("%s refund batch = %v, want %s", name, got, result.BatchID)
		}
	}
	for name, id := range map[string]uuid.UUID{"failed": failed, "after window": later, "other merchant": foreign} {
		if got := refundBatchID(t, pool, id); got != nil {
			t.Errorf("%s refund was claimed by batch %s, want unclaimed", name, *got)
		}
	}

	// Re-closing changes nothing, and a later batch does not claim it twice.
	again, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("re-close: %v", err)
	}
	if !again.AlreadyClosed || again.NetPayoutFils != result.NetPayoutFils {
		t.Errorf("re-close = %+v, want the same figures as %+v", again, result)
	}
	next, err := CloseBatch(context.Background(), pool, merchantID, businessDate.AddDate(0, 0, 1))
	if err != nil {
		t.Fatalf("next day close: %v", err)
	}
	if f := readBatchRefundFigures(t, pool, next.BatchID); f.refund != 4000 {
		t.Errorf("next day refund_fils = %d, want 4000 (only the refund not yet claimed)", f.refund)
	}
}

// A recalculation changes the fee and nothing else: it must not erase the
// refunds already netted out of the batch.
func TestRecalculateMDR_KeepsRefundNetting(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 4, 12, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	txnID, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, start.Add(time.Hour))
	insertRefund(t, pool, merchantID, txnID, 2000, 50, "succeeded", start.Add(2*time.Hour))
	result, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 300 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("raise mdr: %v", err)
	}
	if _, err := RecalculateMDR(ctx, pool, merchantID, businessDate, businessDate.AddDate(0, 0, 1)); err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}

	f := readBatchRefundFigures(t, pool, result.BatchID)
	if f.net != 7750 {
		t.Errorf("net_payout_fils after recalculation = %d, want 7750 (7800 less the 50 fils fee increase)", f.net)
	}
	if f.refund != 2000 || f.feeReversed != 50 {
		t.Errorf("recalculation changed the refund figures: %+v", f)
	}
}

// A split parent pays out the netted figure across its children, and a batch
// that nets to a shortfall pays nobody.
func TestSplitPayout_UsesNettedFigure(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	parentID := insertActiveMerchant(t, pool, mdrBps)
	childA := insertActiveMerchant(t, pool, mdrBps)
	childB := insertActiveMerchant(t, pool, mdrBps)
	for _, child := range []uuid.UUID{childA, childB} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps)
			VALUES ($1, $2, 5000)
		`, parentID, child); err != nil {
			t.Fatalf("insert split child: %v", err)
		}
	}
	day1 := time.Date(2026, 4, 14, 0, 0, 0, 0, time.UTC)
	day2 := day1.AddDate(0, 0, 1)
	start1, _ := BusinessDayWindow(day1)
	start2, _ := BusinessDayWindow(day2)

	txnID, _ := insertCaptureEvent(t, pool, parentID, mdrBps, 10000, start1.Add(time.Hour))
	insertRefund(t, pool, parentID, txnID, 2000, 50, "succeeded", start1.Add(2*time.Hour))
	first, err := CloseBatch(ctx, pool, parentID, day1)
	if err != nil {
		t.Fatalf("CloseBatch day 1: %v", err)
	}
	if _, err := splits.PayoutSplitBatch(ctx, pool, first.BatchID); err != nil {
		t.Fatalf("PayoutSplitBatch day 1: %v", err)
	}
	if n := countRows(t, pool, `SELECT COALESCE(SUM(allocated_fils), 0)::int FROM settlement_batch_splits WHERE settlement_batch_id = $1`, first.BatchID); n != 7800 {
		t.Errorf("allocated across children = %d, want 7800 (the netted payout)", n)
	}
	if got := ledgerPayable(t, pool, parentID); got != 0 {
		t.Errorf("merchant_payable after split payout = %d, want 0", got)
	}

	insertRefund(t, pool, parentID, txnID, 8000, 200, "succeeded", start2.Add(time.Hour))
	second, err := CloseBatch(ctx, pool, parentID, day2)
	if err != nil {
		t.Fatalf("CloseBatch day 2: %v", err)
	}
	if _, err := splits.PayoutSplitBatch(ctx, pool, second.BatchID); err != nil {
		t.Fatalf("PayoutSplitBatch day 2: %v", err)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM settlement_batch_splits WHERE settlement_batch_id = $1`, second.BatchID); n != 0 {
		t.Errorf("a shortfall batch allocated to %d children, want none", n)
	}
	if f := readBatchRefundFigures(t, pool, second.BatchID); f.carryOut != 7800 {
		t.Errorf("carry_out_fils = %d, want 7800", f.carryOut)
	}
	if got := cachedPayable(t, pool, parentID); got != -7800 {
		t.Errorf("cached_payable_fils = %d, want -7800", got)
	}
}
