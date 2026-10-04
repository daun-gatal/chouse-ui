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
	"sort"
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
	EnvCACert     = "CHOUSE_CA_CERT"
	EnvInsecure   = "CHOUSE_INSECURE_SKIP_TLS_VERIFY"
)

// Profile groups non-secret connection defaults.
type Profile struct {
	Server     string `yaml:"server"`
	Connection string `yaml:"connection"`
	Output     string `yaml:"output"`
	// CACert is a PEM bundle trusted in addition to the system roots, for
	// servers behind an internal CA.
	CACert string `yaml:"ca_cert,omitempty"`
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
	CACert     string
	// InsecureSkipTLSVerify is never stored in a profile: it must be asked
	// for on every invocation (flag or env).
	InsecureSkipTLSVerify bool
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

// ProfileUpdate is the non-secret setup `auth login` remembers.
type ProfileUpdate struct {
	Server string
	CACert string
}

// SaveProfile merges non-secret profile settings into config.yaml without
// touching stored tokens (those live in credentials.yaml). Empty fields
// leave existing values alone — they never clear. makeCurrent switches
// CurrentProfile (used when --profile was explicitly passed at login).
func SaveProfile(profile string, update ProfileUpdate, makeCurrent bool) error {
	if strings.TrimSpace(profile) == "" {
		return errors.New("profile must not be empty")
	}
	dir, err := Dir(true)
	if err != nil {
		return err
	}
	cfg, err := LoadFile()
	if err != nil {
		return err
	}
	p := cfg.Profiles[profile]
	if strings.TrimSpace(update.Server) != "" {
		p.Server = strings.TrimRight(strings.TrimSpace(update.Server), "/")
	}
	if strings.TrimSpace(update.CACert) != "" {
		caCert, err := filepath.Abs(strings.TrimSpace(update.CACert))
		if err != nil {
			return err
		}
		p.CACert = caCert
	}
	cfg.Profiles[profile] = p
	if makeCurrent {
		cfg.CurrentProfile = profile
	}
	raw, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "config.yaml"), raw, 0o600)
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
	CACert     string
	Insecure   bool
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
	// No silent default: an unconfigured server resolves to "" and callers
	// that need one fail fast via RequireServer with setup guidance.
	server := firstNonEmpty(f.Server, os.Getenv(EnvServer), fileProfile.Server)
	connection := firstNonEmpty(f.Connection, os.Getenv(EnvConnection), fileProfile.Connection, "")
	output := firstNonEmpty(f.Output, os.Getenv(EnvOutput), fileProfile.Output, "auto")
	caCert := firstNonEmpty(f.CACert, os.Getenv(EnvCACert), fileProfile.CACert)
	insecure := f.Insecure || truthy(os.Getenv(EnvInsecure))

	return Resolved{
		Server:     strings.TrimRight(strings.TrimSpace(server), "/"),
		Token:      token,
		Connection: strings.TrimSpace(connection),
		Profile:    profile,
		Output:     strings.ToLower(strings.TrimSpace(output)),
		CACert:     caCert,

		InsecureSkipTLSVerify: insecure,
	}, nil
}

func truthy(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// RequireServer fails with an actionable message when no server is
// configured. There is deliberately no localhost default: silently aiming
// at a phantom server masks misconfiguration (and leaks PATs to whatever
// listens there). Mirrors RequireToken.
func (r Resolved) RequireServer() error {
	if strings.TrimSpace(r.Server) == "" {
		return fmt.Errorf("no server configured (profile %q): pass --server, set %s, or run: chouse auth login --server https://chouse.example.com", r.Profile, EnvServer)
	}
	return nil
}

// RequireToken fails with an actionable message when no PAT is configured.
func (r Resolved) RequireToken() error {
	if strings.TrimSpace(r.Token) == "" {
		return fmt.Errorf("no token configured (profile %q): run chouse auth login, or set %s", r.Profile, EnvToken)
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

// ProfileKeys are the settings `chouse config set` accepts. Tokens are not
// among them: they go through `chouse auth login` into credentials.yaml.
var ProfileKeys = []string{"server", "connection", "output", "ca_cert"}

func saveFile(cfg FileConfig) error {
	dir, err := Dir(true)
	if err != nil {
		return err
	}
	raw, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "config.yaml"), raw, 0o600)
}

// SetProfileValue sets one non-secret key on a profile (empty value clears).
func SetProfileValue(profile, key, value string) error {
	if strings.TrimSpace(profile) == "" {
		return errors.New("profile must not be empty")
	}
	cfg, err := LoadFile()
	if err != nil {
		return err
	}
	p := cfg.Profiles[profile]
	value = strings.TrimSpace(value)
	switch key {
	case "server":
		p.Server = strings.TrimRight(value, "/")
	case "connection":
		p.Connection = value
	case "output":
		p.Output = strings.ToLower(value)
	case "ca_cert":
		if value != "" {
			abs, err := filepath.Abs(value)
			if err != nil {
				return err
			}
			value = abs
		}
		p.CACert = value
	default:
		return fmt.Errorf("unknown key %q (one of: %s)", key, strings.Join(ProfileKeys, ", "))
	}
	cfg.Profiles[profile] = p
	return saveFile(cfg)
}

// ProfileValue reads one key of a profile.
func ProfileValue(p Profile, key string) (string, error) {
	switch key {
	case "server":
		return p.Server, nil
	case "connection":
		return p.Connection, nil
	case "output":
		return p.Output, nil
	case "ca_cert":
		return p.CACert, nil
	}
	return "", fmt.Errorf("unknown key %q (one of: %s)", key, strings.Join(ProfileKeys, ", "))
}

// UseProfile makes profile the current one. It must exist (have settings or
// a stored token), so a typo cannot silently switch to an empty profile.
func UseProfile(profile string) error {
	cfg, err := LoadFile()
	if err != nil {
		return err
	}
	creds, err := LoadCredentials()
	if err != nil {
		return err
	}
	_, hasSettings := cfg.Profiles[profile]
	_, hasToken := creds.Tokens[profile]
	if !hasSettings && !hasToken {
		return fmt.Errorf("profile %q does not exist (create it with: chouse auth login --profile %s --server …)", profile, profile)
	}
	cfg.CurrentProfile = profile
	return saveFile(cfg)
}

// ProfileInfo summarizes one profile without secrets.
type ProfileInfo struct {
	Name     string `json:"name" yaml:"name"`
	Current  bool   `json:"current" yaml:"current"`
	Server   string `json:"server" yaml:"server"`
	HasToken bool   `json:"hasToken" yaml:"hasToken"`
}

// ListProfiles returns every profile from config.yaml and credentials.yaml.
func ListProfiles() ([]ProfileInfo, error) {
	cfg, err := LoadFile()
	if err != nil {
		return nil, err
	}
	creds, err := LoadCredentials()
	if err != nil {
		return nil, err
	}
	current := firstNonEmpty(cfg.CurrentProfile, "default")
	names := map[string]bool{}
	for name := range cfg.Profiles {
		names[name] = true
	}
	for name := range creds.Tokens {
		names[name] = true
	}
	out := make([]ProfileInfo, 0, len(names))
	for name := range names {
		_, hasToken := creds.Tokens[name]
		out = append(out, ProfileInfo{Name: name, Current: name == current, Server: cfg.Profiles[name].Server, HasToken: hasToken})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// DeleteProfile removes a profile's settings and stored token.
func DeleteProfile(profile string) error {
	cfg, err := LoadFile()
	if err != nil {
		return err
	}
	delete(cfg.Profiles, profile)
	if cfg.CurrentProfile == profile {
		cfg.CurrentProfile = ""
	}
	if err := saveFile(cfg); err != nil {
		return err
	}
	return DeleteCredentials(profile)
}
