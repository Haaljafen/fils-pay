package settlement

import "github.com/filspay/settlement/internal/money"

// NetPayableFils derives the net payout from frozen gross and fee totals:
// integer fils, exact at any size. Never route this through floating point
// (float32 holds ~7 significant digits, so batches above ~8,192 BD paid out
// the wrong amount).
func NetPayableFils(grossFils, feeFils money.Fils) money.Fils {
	return grossFils - feeFils
}

// PayoutAndCarry splits a batch's position into what is paid now and what the
// next batch must recover. A payout is never negative: a shortfall pays zero
// and is carried, and the ledger keeps merchant_payable negative until then.
func PayoutAndCarry(positionFils money.Fils) (payoutFils, carryOutFils money.Fils) {
	if positionFils < 0 {
		return 0, -positionFils
	}
	return positionFils, 0
}
