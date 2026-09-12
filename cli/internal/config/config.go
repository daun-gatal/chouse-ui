// Package config resolves CLI settings with a strict precedence chain:
//
//	flag > environment > credentials/config file > profile default.
//
// Secrets live only in the environment (CH_HOUSE_PAT) or the 0600
// credentials file. The YAML config file never triggers variable expansion
// and never stores raw PATs beyond the credentials file.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Env keys reserved by ADR 0011/0012. Client-side only; the server reads no
// CLI env.
const (
	EnvToken      = "CH_HOUSE_PAT"
	EnvServer     = "CHOUSE_SERVER"
	EnvConnection = "CHOUSE_CONNECTION"
	EnvProfile    = "CHOUSE_PROFILE"
	EnvOutput     = "CHOUSE_OUTPUT"
)

// Profile groups non-secret connection defaults.
type Profile struct {
	Server     string `yaml:"server"`
	Connection string `yaml:"connection"`
	Output     string `yaml:"output"`
}

// FileConfig is ~/.config/chouse/config.yaml.
type FileConfig struct {
	CurrentProfile string             `yaml:"current_profile"`
	Profiles       map[string]Profile `yaml:"profiles"`
}

// Credentials is ~/.config/chouse/credentials.yaml (0600).
type Credentials struct {
	Tokens map[string]string `yaml:"tokens"`
}

// Resolved is the effective runtime configuration for one invocation.
type Resolved struct {
	Server     string
	Token      string
	Connection string
	Profile    string
	Output     string
}

// Dir returns ~/.config/chouse, creating it with 0700 when asked.
func Dir(create bool) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".config", "chouse")
	if create {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// configPath returns the config file path.
func configPath() (string, error) {
	dir, err := Dir(false)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.yaml"), nil
}

// credentialsPath returns the credentials file path.
func credentialsPath() (string, error) {
	dir, err := Dir(false)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "credentials.yaml"), nil
}

// LoadFile returns the YAML config or an empty default when absent.
func LoadFile() (FileConfig, error) {
	cfg := FileConfig{Profiles: map[string]Profile{}}
	path, err := configPath()
	if err != nil {
		return cfg, err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return cfg, fmt.Errorf("parse %s: %w", path, err)
	}
	if cfg.Profiles == nil {
		cfg.Profiles = map[string]Profile{}
	}
	return cfg, nil
}

// LoadCredentials returns stored PATs or empty when absent.
func LoadCredentials() (Credentials, error) {
	creds := Credentials{Tokens: map[string]string{}}
	path, err := credentialsPath()
	if err != nil {
		return creds, err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return creds, nil
	}
	if err != nil {
		return creds, err
	}
	if err := yaml.Unmarshal(raw, &creds); err != nil {
		return creds, fmt.Errorf("parse %s: %w", path, err)
	}
	if creds.Tokens == nil {
		creds.Tokens = map[string]string{}
	}
	return creds, nil
}

// SaveCredentials persists one profile token with 0600 permissions.
func SaveCredentials(profile, token string) error {
	if strings.TrimSpace(profile) == "" {
		return errors.New("profile must not be empty")
	}
	if strings.TrimSpace(token) == "" {
		return errors.New("token must not be empty")
	}
	dir, err := Dir(true)
	if err != nil {
		return err
	}
	creds, err := LoadCredentials()
	if err != nil {
		return err
	}
	creds.Tokens[profile] = token
	raw, err := yaml.Marshal(creds)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "credentials.yaml"), raw, 0o600)
}

// DeleteCredentials removes the stored token for a profile.
func DeleteCredentials(profile string) error {
	creds, err := LoadCredentials()
	if err != nil {
		return err
	}
	delete(creds.Tokens, profile)
	dir, err := Dir(true)
	if err != nil {
		return err
	}
	raw, err := yaml.Marshal(creds)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "credentials.yaml"), raw, 0o600)
}

// Flags carries explicit CLI flag values (empty = unset).
type Flags struct {
	Server     string
	Token      string
	Connection string
	Profile    string
	Output     string
}

// Resolve applies flag > env > file precedence.
func Resolve(f Flags) (Resolved, error) {
	fileCfg, err := LoadFile()
	if err != nil {
		return Resolved{}, err
	}
	creds, err := LoadCredentials()
	if err != nil {
		return Resolved{}, err
	}

	profile := firstNonEmpty(f.Profile, os.Getenv(EnvProfile), fileCfg.CurrentProfile, "default")

	token := strings.TrimSpace(f.Token)
	if token == "" {
		token = strings.TrimSpace(os.Getenv(EnvToken))
	}
	if token == "" {
		token = strings.TrimSpace(creds.Tokens[profile])
	}

	fileProfile := fileCfg.Profiles[profile]
	server := firstNonEmpty(f.Server, os.Getenv(EnvServer), fileProfile.Server, "http://localhost:5521")
	connection := firstNonEmpty(f.Connection, os.Getenv(EnvConnection), fileProfile.Connection, "")
	output := firstNonEmpty(f.Output, os.Getenv(EnvOutput), fileProfile.Output, "table")

	return Resolved{
		Server:     strings.TrimRight(strings.TrimSpace(server), "/"),
		Token:      token,
		Connection: strings.TrimSpace(connection),
		Profile:    profile,
		Output:     strings.ToLower(strings.TrimSpace(output)),
	}, nil
}

// RequireToken fails with an actionable message when no PAT is configured.
func (r Resolved) RequireToken() error {
	if strings.TrimSpace(r.Token) == "" {
		return fmt.Errorf("no PAT configured (profile %q): set %s, pass --token, or run: chouse auth login --token ch_pat_…", r.Profile, EnvToken)
	}
	return nil
}

// MaskToken renders only the safe display form of a PAT.
func MaskToken(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return "(none)"
	}
	if len(token) <= 12 {
		return "ch_pat_…(masked)"
	}
	return token[:7] + "…" + token[len(token)-4:] + " (masked)"
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
