package splits

import (
	"testing"

	"github.com/filspay/settlement/internal/money"
)

func TestChildShares_SumToNet(t *testing.T) {
	cases := []struct {
		name       string
		netPayout  money.Fils
		weightsBps []int64
	}{
		{"two equal", 10000, []int64{5000, 5000}},
		{"three round", 9000, []int64{3000, 3000, 4000}},
		{"single child", 5000, []int64{10000}},
		{"thirds that round up", 1001, []int64{3333, 3333, 3334}},
		{"thirds that round down", 1000, []int64{3333, 3333, 3334}},
		{"odd net, uneven weights", 99_999, []int64{1, 4999, 5000}},
		{"weights summing to 60% still pay the whole net", 1001, []int64{3000, 3000}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			children := make([]ChildWeight, len(tc.weightsBps))
			for i, w := range tc.weightsBps {
				children[i] = ChildWeight{WeightBps: w}
			}
			shares := ChildShares(tc.netPayout, children)
			var total money.Fils
			for _, s := range shares {
				total += s
			}
			if total != tc.netPayout {
				t.Errorf("sum of shares %d != net payout %d", total, tc.netPayout)
			}
		})
	}
}

func TestChildShares_LargestRemainderIsDeterministic(t *testing.T) {
	// 1001 fils at 3333/3333/3334 bps: exact shares 333.6333, 333.6333,
	// 333.7334; floors 333+333+333 = 999, the 2 leftover fils go to the
	// largest remainders (the third child, then the first by index).
	children := []ChildWeight{{WeightBps: 3333}, {WeightBps: 3333}, {WeightBps: 3334}}
	got := ChildShares(1001, children)
	want := []money.Fils{334, 333, 334}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("ChildShares(1001, 3333/3333/3334) = %v, want %v", got, want)
		}
	}
}
