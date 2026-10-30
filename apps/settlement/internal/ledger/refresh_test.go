package ledger

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// insertSettledBatchWithLine adds a paid batch and its scheme export line for
// a capture that the ledger already records, the way CloseBatch/PayoutBatch
// leave them. The export line carries the gross; the balance must not.
func insertSettledBatchWithLine(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, batchDate string, grossFils, feeFils int64) {
	t.Helper()
	ctx := context.Background()

	var batchID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at, paid_at)
		VALUES ($1, $2, 'paid', $3, $4, $5, now(), now())
		RETURNING id
	`, merchantID, batchDate, grossFils, feeFils, grossFils-feeFils).Scan(&batchID)
	if err != nil {
		t.Fatalf("insertSettledBatchWithLine: insert batch: %v", err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO scheme_export_lines (settlement_batch_id, amount_fils, line_sequence)
		VALUES ($1, $2, 1)
	`, batchID, (grossFils/10)*10)
	if err != nil {
		t.Fatalf("insertSettledBatchWithLine: insert export line: %v", err)
	}
}

func cachedBalance(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) int64 {
	t.Helper()
	var persisted int64
	err := pool.QueryRow(context.Background(), `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&persisted)
	if err != nil {
		t.Fatalf("query persisted balance: %v", err)
	}
	return persisted
}

// A merchant captured 100.000 BD, was charged a 2.500 BD fee and was paid out
// 97.500 BD: they are owed nothing. The admin "Rebuild cached balances"
// button must say 0, the same figure the ledger (and the CLI rebuild) gives,
// not the 100.000 BD that was exported to the card scheme.
func TestRefreshBalanceCache_FollowsTheLedgerNotTheSchemeFile(t *testing.T) {
	pool := mustPool(t)
	merchantID := insertActiveMerchant(t, pool)

	postLedgerLeg(t, pool, merchantID, "credit", 100_000) // capture: gross
	postLedgerLeg(t, pool, merchantID, "debit", 2_500)    // capture: MDR fee
	postLedgerLeg(t, pool, merchantID, "debit", 97_500)   // settlement payout
	insertSettledBatchWithLine(t, pool, merchantID, "2026-06-10", 100_000, 2_500)

	diffs, err := RefreshBalanceCache(context.Background(), pool)
	if err != nil {
		t.Fatalf("RefreshBalanceCache: %v", err)
	}
	if got := int64(diffs[merchantID].Rebuilt); got != 0 {
		t.Errorf("rebuilt balance = %d, want 0 (100000 captured - 2500 fee - 97500 paid out)", got)
	}
	if got := cachedBalance(t, pool, merchantID); got != 0 {
		t.Errorf("persisted cached_payable_fils = %d, want 0", got)
	}
}

// Captured but not yet settled: the merchant is owed the net, even though
// nothing has reached the scheme file yet.
func TestRefreshBalanceCache_CountsUnsettledActivity(t *testing.T) {
	pool := mustPool(t)
	merchantID := insertActiveMerchant(t, pool)

	postLedgerLeg(t, pool, merchantID, "credit", 40_000)
	postLedgerLeg(t, pool, merchantID, "debit", 1_000)

	diffs, err := RefreshBalanceCache(context.Background(), pool)
	if err != nil {
		t.Fatalf("RefreshBalanceCache: %v", err)
	}
	if got := int64(diffs[merchantID].Rebuilt); got != 39_000 {
		t.Errorf("rebuilt balance = %d, want 39000", got)
	}
}

func TestRefreshBalanceCache_OverwritesDriftedCache(t *testing.T) {
	pool := mustPool(t)
	merchantID := insertActiveMerchant(t, pool)
	postLedgerLeg(t, pool, merchantID, "credit", 25_000)

	_, err := pool.Exec(context.Background(), `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
		VALUES ($1, 888888, now())
	`, merchantID)
	if err != nil {
		t.Fatalf("seed drifted cache: %v", err)
	}

	diffs, err := RefreshBalanceCache(context.Background(), pool)
	if err != nil {
		t.Fatalf("RefreshBalanceCache: %v", err)
	}
	diff := diffs[merchantID]
	if diff.CachedBefore != 888888 || int64(diff.Rebuilt) != 25_000 || !diff.Changed() {
		t.Errorf("diff = %+v, want CachedBefore 888888, Rebuilt 25000, Changed", diff)
	}
	if got := cachedBalance(t, pool, merchantID); got != 25_000 {
		t.Errorf("persisted cached_payable_fils = %d, want 25000", got)
	}
}
