package ledger

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// RefreshBalanceCache recomputes every merchant's cached balance from the
// ledger (the merchant_payable account) and overwrites merchant_balances —
// the same figure RebuildAllBalances and the `rebuild-balances` CLI produce.
// It backs the admin console's "Rebuild cached balances" button.
//
// It used to read merchant_payable_position (migration 0054), the lifetime
// total of scheme export lines. That figure ignores fees, payouts,
// adjustments and anything not yet settled, so the button overwrote every
// merchant's balance with the wrong number. The ledger is the only source.
//
// One statement with a single grouped scan of ledger_entries, rather than a
// query per merchant, so it fits inside the internal API's request timeout.
// Data-modifying CTEs all see the same snapshot, so `before` is the cache as
// it was before this statement's upsert.
func RefreshBalanceCache(ctx context.Context, db *pgxpool.Pool) (map[uuid.UUID]RebuildDiff, error) {
	rows, err := db.Query(ctx, `
		WITH ledger AS (
			SELECT merchant_id,
			       SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END) AS payable_fils
			  FROM ledger_entries
			 WHERE account_id = 'merchant_payable'
			 GROUP BY merchant_id
		),
		before AS (
			SELECT merchant_id, cached_payable_fils FROM merchant_balances
		),
		merchants AS (
			SELECT merchant_id FROM ledger
			UNION
			SELECT merchant_id FROM before
		),
		upserted AS (
			INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
			SELECT m.merchant_id, COALESCE(l.payable_fils, 0), now()
			  FROM merchants m
			  LEFT JOIN ledger l ON l.merchant_id = m.merchant_id
			ON CONFLICT (merchant_id) DO UPDATE
			  SET cached_payable_fils = EXCLUDED.cached_payable_fils, updated_at = now()
			RETURNING merchant_id, cached_payable_fils
		)
		SELECT u.merchant_id, COALESCE(b.cached_payable_fils, 0), u.cached_payable_fils
		  FROM upserted u
		  LEFT JOIN before b ON b.merchant_id = u.merchant_id
	`)
	if err != nil {
		return nil, fmt.Errorf("ledger: RefreshBalanceCache: %w", err)
	}
	defer rows.Close()

	diffs := make(map[uuid.UUID]RebuildDiff)
	for rows.Next() {
		var merchantID uuid.UUID
		var before, rebuilt int64
		if err := rows.Scan(&merchantID, &before, &rebuilt); err != nil {
			return nil, fmt.Errorf("ledger: RefreshBalanceCache: scan: %w", err)
		}
		diffs[merchantID] = RebuildDiff{
			MerchantID:   merchantID,
			CachedBefore: money.Fils(before),
			Rebuilt:      money.Fils(rebuilt),
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ledger: RefreshBalanceCache: %w", err)
	}
	return diffs, nil
}
