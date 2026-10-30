package splits

import (
	"sort"

	"github.com/filspay/settlement/internal/money"
)

// ChildWeight is one sub-merchant's configured share of a parent's payout.
type ChildWeight struct {
	WeightBps int64
}

// ChildShares distributes netPayout across children in proportion to their
// weights, and the shares always sum to exactly netPayout. Rounding each
// child on its own (ApplyRateFils per child) could pay out a fil more than
// the batch owed, or leave fils unpaid. This is the largest-remainder method
// @filspay/money's allocateRemainder uses: every child gets the floor of its
// exact share, and the leftover fils go one at a time to the largest
// remainders, ties broken by position, so the result is deterministic.
//
// Weights are expected to sum to 10000 (migration 0045). If they don't, the
// whole payout is still divided in proportion to them rather than leaving
// part of it unpaid; PayoutSplitBatch logs that case.
func ChildShares(netPayout money.Fils, children []ChildWeight) []money.Fils {
	shares := make([]money.Fils, len(children))
	var weightSum int64
	for _, c := range children {
		weightSum += c.WeightBps
	}
	if len(children) == 0 || weightSum <= 0 || netPayout <= 0 {
		return shares
	}

	total := int64(netPayout)
	remainders := make([]int64, len(children))
	var allocated int64
	for i, c := range children {
		product := total * c.WeightBps
		shares[i] = money.Fils(product / weightSum)
		remainders[i] = product % weightSum
		allocated += int64(shares[i])
	}

	order := make([]int, len(children))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return remainders[order[a]] > remainders[order[b]] })
	for k := 0; allocated < total; k++ {
		shares[order[k%len(order)]]++
		allocated++
	}
	return shares
}
