package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/filspay/settlement/internal/money"
)

// ADR-0002: each scheme export line is the transaction's gross truncated to
// a multiple of 10 fils; the file's `amount` must be exactly amount_fils/1000
// (never rounded), and the dropped 0–9 fils are journaled per line from
// card_scheme_clearing (credit) to scheme_rounding_residue (debit).
func TestCloseBatch_SchemeLinesTruncateAndJournalResidue(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 25, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	cases := []struct {
		gross       money.Fils
		wantAmount  string
		wantResidue int64
	}{
		{4747, "4.74", 7},
		{4755, "4.75", 5}, // float -> NUMERIC(10,2) rounded this to 4.76
		{12344, "12.34", 4},
		{4740, "4.74", 0},
	}
	txnIDs := make([]uuid.UUID, len(cases))
	for i, c := range cases {
		txnIDs[i], _ = insertCaptureEvent(t, pool, merchantID, mdrBps, c.gross, start.Add(time.Duration(i+1)*time.Hour))
	}

	result, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	for i, c := range cases {
		var amountFils int64
		var amount string
		err := pool.QueryRow(ctx, `
			SELECT amount_fils, amount::text FROM scheme_export_lines
			 WHERE settlement_batch_id = $1 AND transaction_id = $2
		`, result.BatchID, txnIDs[i]).Scan(&amountFils, &amount)
		if err != nil {
			t.Fatalf("gross %d: read export line: %v", c.gross, err)
		}
		if amount != c.wantAmount {
			t.Errorf("gross %d: amount = %s, want %s (amount_fils %d / 1000, truncated)", c.gross, amount, c.wantAmount, amountFils)
		}

		var residueDebit, clearingCredit int64
		err = pool.QueryRow(ctx, `
			SELECT
			  COALESCE(SUM(amount_fils) FILTER (WHERE account_id = 'scheme_rounding_residue' AND direction = 'debit'), 0),
			  COALESCE(SUM(amount_fils) FILTER (WHERE account_id = 'card_scheme_clearing' AND direction = 'credit'), 0)
			  FROM ledger_entries WHERE transaction_id = $1
		`, txnIDs[i]).Scan(&residueDebit, &clearingCredit)
		if err != nil {
			t.Fatalf("gross %d: read residue legs: %v", c.gross, err)
		}
		if residueDebit != c.wantResidue || clearingCredit != c.wantResidue {
			t.Errorf("gross %d: residue legs = debit %d / credit %d, want %d / %d",
				c.gross, residueDebit, clearingCredit, c.wantResidue, c.wantResidue)
		}

		// What remains in clearing for this transaction is exactly what the
		// scheme will pay for it.
		var clearingNet int64
		err = pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END), 0)
			  FROM ledger_entries WHERE transaction_id = $1 AND account_id = 'card_scheme_clearing'
		`, txnIDs[i]).Scan(&clearingNet)
		if err != nil {
			t.Fatalf("gross %d: read clearing net: %v", c.gross, err)
		}
		if clearingNet != amountFils {
			t.Errorf("gross %d: card_scheme_clearing net = %d, want %d (the exported amount)", c.gross, clearingNet, amountFils)
		}
	}
}
