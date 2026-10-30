// Package ledger rebuilds merchant_balances from ledger_entries. Nothing
// automatic calls this — the incremental path is in internal/balances.
// This is for the manual `rebuild-balances` CLI subcommand.
package ledger

import (
	"context"
	"fmt"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// RebuildMerchantBalance recomputes merchantID's cached balance from
// ledger_entries. CLI-only; the incremental path is in internal/balances.
func RebuildMerchantBalance(ctx context.Context, db *pgxpool.Pool, merchantID uuid.UUID) (money.Fils, error) {
	var balance int64
	err := db.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)
		  FROM ledger_entries
		 WHERE merchant_id = $1 AND account_id = 'merchant_payable'
	`, merchantID).Scan(&balance)
	if err != nil {
		return 0, fmt.Errorf("ledger: RebuildMerchantBalance(%s): %w", merchantID, err)
	}
	return money.Fils(balance), nil
}

// RebuildDiff is the before/after state for one merchant, printed by the
// rebuild-balances CLI subcommand so an operator sees exactly what
// changed.
//
// Changed reports drift against the ledger: a false result means the cache
// already matched ledger_entries for that merchant.
type RebuildDiff struct {
	MerchantID   uuid.UUID
	CachedBefore money.Fils
	Rebuilt      money.Fils
}

// Changed reports whether the cached value differed from the rebuilt,
// authoritative one.
func (d RebuildDiff) Changed() bool {
	return d.CachedBefore != d.Rebuilt
}

// RebuildAllBalances recomputes every merchant's balance the same way and
// overwrites merchant_balances in one transaction. Returns the full
// before/after map so a caller (the rebuild-balances CLI subcommand) can
// print exactly what changed. The only function in this codebase that
// writes merchant_balances from a full ledger recompute rather than an
// incremental delta.
func RebuildAllBalances(ctx context.Context, db *pgxpool.Pool) (map[uuid.UUID]RebuildDiff, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, `
		SELECT DISTINCT merchant_id FROM (
			SELECT merchant_id FROM ledger_entries WHERE account_id = 'merchant_payable'
			UNION
			SELECT merchant_id FROM merchant_balances
		) merchants
	`)
	if err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: select merchant ids: %w", err)
	}

	var merchantIDs []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("ledger: RebuildAllBalances: scan merchant id: %w", err)
		}
		merchantIDs = append(merchantIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: iterate merchant ids: %w", err)
	}
	rows.Close()

	// Lock every merchant's balance row before reading any ledger sum. The
	// incremental writers (CloseBatch, adjustments) update these rows
	// relatively and hold each lock until they commit, so this waits for
	// anything in flight, and the sums below see everything it wrote. Without
	// the lock the rebuild overwrote an increment with a value computed from a
	// snapshot taken before it. Rows are taken in merchant_id order, the same
	// order for every caller, so two rebuilds or a rebuild and a close cannot
	// deadlock on each other.
	diffs := make(map[uuid.UUID]RebuildDiff, len(merchantIDs))
	sort.Slice(merchantIDs, func(i, j int) bool { return merchantIDs[i].String() < merchantIDs[j].String() })
	if _, err := tx.Exec(ctx, `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
		SELECT id, 0, now() FROM unnest($1::uuid[]) AS id ORDER BY id
		ON CONFLICT (merchant_id) DO NOTHING
	`, merchantIDs); err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: ensure balance rows: %w", err)
	}
	cachedBefore := make(map[uuid.UUID]int64, len(merchantIDs))
	lockRows, err := tx.Query(ctx, `
		SELECT merchant_id, cached_payable_fils FROM merchant_balances
		 WHERE merchant_id = ANY($1::uuid[])
		 ORDER BY merchant_id
		   FOR UPDATE
	`, merchantIDs)
	if err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: lock cached balances: %w", err)
	}
	for lockRows.Next() {
		var id uuid.UUID
		var cached int64
		if err := lockRows.Scan(&id, &cached); err != nil {
			lockRows.Close()
			return nil, fmt.Errorf("ledger: RebuildAllBalances: scan locked balance: %w", err)
		}
		cachedBefore[id] = cached
	}
	if err := lockRows.Err(); err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: iterate locked balances: %w", err)
	}
	lockRows.Close()

	for _, merchantID := range merchantIDs {
		var rebuilt int64
		err = tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)
			  FROM ledger_entries
			 WHERE merchant_id = $1 AND account_id = 'merchant_payable'
		`, merchantID).Scan(&rebuilt)
		if err != nil {
			return nil, fmt.Errorf("ledger: RebuildAllBalances: recompute balance for %s: %w", merchantID, err)
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
			VALUES ($1, $2, now())
			ON CONFLICT (merchant_id) DO UPDATE
			  SET cached_payable_fils = $2, updated_at = now()
		`, merchantID, rebuilt)
		if err != nil {
			return nil, fmt.Errorf("ledger: RebuildAllBalances: write rebuilt balance for %s: %w", merchantID, err)
		}

		diffs[merchantID] = RebuildDiff{
			MerchantID:   merchantID,
			CachedBefore: money.Fils(cachedBefore[merchantID]),
			Rebuilt:      money.Fils(rebuilt),
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("ledger: RebuildAllBalances: commit: %w", err)
	}

	return diffs, nil
}
