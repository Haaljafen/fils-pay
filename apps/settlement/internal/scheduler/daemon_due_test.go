package scheduler

import (
	"testing"
	"time"
)

// The settlement day is Asia/Bahrain (UTC+3). The daemon must close
// "yesterday" DaemonRunDelayMinutes after Bahrain midnight, including during
// the first three Bahrain hours of the day, which are still the previous
// day in UTC.
func TestDueBusinessDate(t *testing.T) {
	cases := []struct {
		name     string
		now      string // UTC instant
		wantDue  bool
		wantDate string // Bahrain business date to close
	}{
		{"00:10 Bahrain, before the 15-minute delay", "2026-05-14T21:10:00Z", false, ""},
		{"00:20 Bahrain, just past the delay", "2026-05-14T21:20:00Z", true, "2026-05-14"},
		{"02:59 Bahrain, still the previous UTC day", "2026-05-14T23:59:00Z", true, "2026-05-14"},
		{"03:00 Bahrain", "2026-05-15T00:00:00Z", true, "2026-05-14"},
		{"23:50 Bahrain", "2026-05-15T20:50:00Z", true, "2026-05-14"},
	}
	for _, c := range cases {
		now, _ := time.Parse(time.RFC3339, c.now)
		date, due := dueBusinessDate(now, 15)
		if due != c.wantDue {
			t.Errorf("%s: due = %v, want %v", c.name, due, c.wantDue)
			continue
		}
		if due && date.Format("2006-01-02") != c.wantDate {
			t.Errorf("%s: closes %s, want %s", c.name, date.Format("2006-01-02"), c.wantDate)
		}
	}
}
