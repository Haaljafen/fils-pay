package settlement

import (
	"testing"

	"github.com/filspay/settlement/internal/money"
)

// The net payout is what the merchant is actually paid, so it must be exactly
// gross minus fee, to the fil, at any size.
func TestNetPayableFils_ExactToTheFil(t *testing.T) {
	cases := []struct{ gross, fee money.Fils }{
		{0, 0},
		{1_000, 25},
		{8_192_022, 204_800}, // 8,192.022 BD: the first size where float32 breaks
		{12_345_678, 308_642},
		{999_999_999, 24_999_999},
		{9_000_000_000_000, 225_000_000_000},
	}
	for _, c := range cases {
		if got, want := NetPayableFils(c.gross, c.fee), c.gross-c.fee; got != want {
			t.Errorf("NetPayableFils(%d, %d) = %d, want %d (off by %d fils)", c.gross, c.fee, got, want, got-want)
		}
	}
}

func TestNetPayableFils_ExactAcrossRealisticBatchSizes(t *testing.T) {
	// 2.5% MDR on every gross from 1 BD to 50,000 BD in steps of 7 fils.
	for gross := money.Fils(1_000); gross <= 50_000_000; gross += 7 {
		fee := gross * 25 / 1000
		if got := NetPayableFils(gross, fee); got != gross-fee {
			t.Fatalf("NetPayableFils(%d, %d) = %d, want %d", gross, fee, got, gross-fee)
		}
	}
}
