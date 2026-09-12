// Command chouse is the safe browserless operator for CHouse UI.
package main

import (
	"fmt"
	"os"

	"github.com/daun-gatal/chouse-ui/cli/internal/api"
	"github.com/daun-gatal/chouse-ui/cli/internal/cli"
)

var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	root := cli.NewRoot(version, commit, date)
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error: "+err.Error())
		os.Exit(api.ExitUsage)
	}
}
