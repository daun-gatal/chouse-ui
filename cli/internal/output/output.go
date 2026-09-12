// Package output renders machine-stable results for humans and agents.
package output

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"gopkg.in/yaml.v3"
)

// Format names accepted by --output.
const (
	JSON = "json"
	YAML = "yaml"
)

// Print renders value in the requested format to w. An empty format is
// the JSON default.
func Print(w io.Writer, format string, value any) error {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", JSON:
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(value)
	case YAML:
		raw, err := yaml.Marshal(value)
		if err != nil {
			return err
		}
		_, err = w.Write(raw)
		return err
	default:
		return fmt.Errorf("unknown --output %q (want json|yaml)", format)
	}
}
