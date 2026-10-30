package ledger

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// A concurrent CloseBatch-style increment (ledger entry + relative balance
// update) that is in flight while RebuildAllBalances runs must survive the
// rebuild. Before the fix, the rebuild summed and then overwrote the cache
// without locking the merchant's balance row, so the in-flight increment was
// lost: the cache was left at the pre-increment value, below the ledger.
func TestRebuildAllBalances_DoesNotLoseConcurrentIncrement(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool)

	postLedgerLeg(t, pool, merchantID, "credit", 5000)
	if _, err := RebuildAllBalances(ctx, pool); err != nil {
		t.Fatalf("seed rebuild: %v", err)
	}

	// The in-flight "CloseBatch": ledger entry plus the relative cache
	// increment, uncommitted, holding the merchant's balance row.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	groupID := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($1, $2, 'merchant_payable', 'credit', 1000, now(), 'in-flight'),
		       ($1, $2, 'card_scheme_clearing', 'debit', 1000, now(), 'in-flight (other side)')`,
		groupID, merchantID); err != nil {
		t.Fatalf("insert in-flight ledger: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at) VALUES ($1, 1000, now())
		ON CONFLICT (merchant_id) DO UPDATE SET cached_payable_fils = merchant_balances.cached_payable_fils + 1000, updated_at = now()`,
		merchantID); err != nil {
		t.Fatalf("in-flight balance increment: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := RebuildAllBalances(ctx, pool)
		done <- err
	}()
	time.Sleep(500 * time.Millisecond) // let the rebuild reach the merchant while the increment is open
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit in-flight: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("RebuildAllBalances: %v", err)
	}

	var cached int64
	if err := pool.QueryRow(ctx, `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&cached); err != nil {
		t.Fatalf("read cache: %v", err)
	}
	var ledgerSum int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)
		  FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'`, merchantID).Scan(&ledgerSum); err != nil {
		t.Fatalf("ledger sum: %v", err)
	}
	if cached != ledgerSum {
		t.Errorf("cached balance %d does not match ledger %d: the concurrent increment was lost", cached, ledgerSum)
	}
}

