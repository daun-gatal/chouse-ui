package cli

import (
	"testing"
)

func TestTimeoutSecsClamp(t *testing.T) {
	old := flagTimeout
	defer func() { flagTimeout = old }()
	for _, tc := range []struct {
		in   int
		want int
	}{
		{-5, 60},
		{0, 60},
		{1, 1},
		{30, 30},
		{600, 600},
		{601, 60},
	} {
		flagTimeout = tc.in
		if got := timeoutSecs(); got != tc.want {
			t.Errorf("timeoutSecs(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}
}
