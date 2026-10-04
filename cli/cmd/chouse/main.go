// Command chouse operates CHouse UI from the terminal, scripts and CI.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/daun-gatal/chouse-ui/cli/internal/cli"
)

var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	// Ctrl-C and SIGTERM cancel the running request instead of killing the
	// process mid-write.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := cli.Run(ctx, os.Args[1:], cli.StdStreams(), version, commit, date)
	stop()
	os.Exit(code)
}
