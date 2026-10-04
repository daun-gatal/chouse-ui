package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolvePrecedence(t *testing.T) {
	t.Setenv(EnvToken, "")
	t.Setenv(EnvServer, "")
	t.Setenv(EnvConnection, "")
	t.Setenv(EnvProfile, "")
	t.Setenv(EnvOutput, "")

	// Isolate HOME so we never touch the real user config.
	home := t.TempDir()
	t.Setenv("HOME", home)

	got, err := Resolve(Flags{Server: "http://flag:5521", Token: "ch_pat_flag"})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.Server != "http://flag:5521" || got.Token != "ch_pat_flag" {
		t.Fatalf("flag precedence broken: %+v", got)
	}

	t.Setenv(EnvToken, "ch_pat_env")
	t.Setenv(EnvServer, "http://env:5521")
	got, err = Resolve(Flags{})
	if err != nil {
		t.Fatalf("Resolve env: %v", err)
	}
	if got.Server != "http://env:5521" || got.Token != "ch_pat_env" {
		t.Fatalf("env precedence broken: %+v", got)
	}
}

func TestSaveCredentialsUses0600(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	if err := SaveCredentials("test", "ch_pat_secret"); err != nil {
		t.Fatalf("SaveCredentials: %v", err)
	}
	creds, err := LoadCredentials()
	if err != nil {
		t.Fatalf("LoadCredentials: %v", err)
	}
	if creds.Tokens["test"] != "ch_pat_secret" {
		t.Fatalf("token not persisted: %+v", creds)
	}
	info, err := os.Stat(filepath.Join(home, ".config", "chouse", "credentials.yaml"))
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("credentials file must be 0600, got %o", info.Mode().Perm())
	}
}

func TestMaskToken(t *testing.T) {
	if MaskToken("") != "(none)" {
		t.Fatal("empty token should render (none)")
	}
	masked := MaskToken("ch_pat_abcdefghijklmnop")
	if masked == "ch_pat_abcdefghijklmnop" {
		t.Fatal("raw token must never render")
	}
}

func TestResolveNoSilentDefault(t *testing.T) {
	t.Setenv(EnvToken, "")
	t.Setenv(EnvServer, "")
	t.Setenv(EnvConnection, "")
	t.Setenv(EnvProfile, "")
	t.Setenv(EnvOutput, "")

	// Isolate HOME so we never touch the real user config.
	home := t.TempDir()
	t.Setenv("HOME", home)

	// No flag/env/file value: server must stay empty, never a phantom
	// localhost default. Callers that need one fail via RequireServer.
	got, err := Resolve(Flags{})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.Server != "" {
		t.Fatalf("expected empty server without configuration, got %q", got.Server)
	}
}

func TestRequireServer(t *testing.T) {
	r := Resolved{Profile: "default"}
	if err := r.RequireServer(); err == nil {
		t.Fatal("expected error without server")
	}
	r.Server = "http://host:5521"
	if err := r.RequireServer(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSaveProfile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	// Set with makeCurrent: creates entry, switches current, 0600 file.
	if err := SaveProfile("default", ProfileUpdate{Server: "https://host:5521/"}, true); err != nil {
		t.Fatalf("SaveProfile: %v", err)
	}
	cfg, err := LoadFile()
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if cfg.Profiles["default"].Server != "https://host:5521" {
		t.Fatalf("server not persisted (trailing slash must be trimmed): %+v", cfg.Profiles["default"])
	}
	if cfg.CurrentProfile != "default" {
		t.Fatalf("current profile not switched: %q", cfg.CurrentProfile)
	}
	info, err := os.Stat(filepath.Join(home, ".config", "chouse", "config.yaml"))
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config file must be 0600, got %o", info.Mode().Perm())
	}

	// Merge: empty server preserves, other profiles and current untouched,
	// tokens file untouched (secrets never land in config.yaml).
	if err := SaveCredentials("default", "ch_pat_secret"); err != nil {
		t.Fatalf("SaveCredentials: %v", err)
	}
	if err := SaveProfile("other", ProfileUpdate{Server: "https://other:5521"}, false); err != nil {
		t.Fatalf("SaveProfile other: %v", err)
	}
	if err := SaveProfile("default", ProfileUpdate{}, false); err != nil {
		t.Fatalf("SaveProfile empty: %v", err)
	}
	cfg, err = LoadFile()
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if cfg.Profiles["default"].Server != "https://host:5521" {
		t.Fatalf("empty save must preserve server: %+v", cfg.Profiles["default"])
	}
	if cfg.Profiles["other"].Server != "https://other:5521" {
		t.Fatalf("other profile lost: %+v", cfg.Profiles)
	}
	if cfg.CurrentProfile != "default" {
		t.Fatalf("current profile must be preserved: %q", cfg.CurrentProfile)
	}
	raw, err := os.ReadFile(filepath.Join(home, ".config", "chouse", "config.yaml"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if strings.Contains(string(raw), "ch_pat_secret") {
		t.Fatal("token must never be written to config.yaml")
	}
	creds, err := LoadCredentials()
	if err != nil {
		t.Fatalf("LoadCredentials: %v", err)
	}
	if creds.Tokens["default"] != "ch_pat_secret" {
		t.Fatal("SaveProfile must not disturb credentials.yaml")
	}
}

func TestRequireToken(t *testing.T) {
	r := Resolved{Profile: "default"}
	if err := r.RequireToken(); err == nil {
		t.Fatal("expected error without token")
	}
	r.Token = "ch_pat_x"
	if err := r.RequireToken(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResolveOutputDefaultJSON(t *testing.T) {
	t.Setenv(EnvOutput, "")

	// Isolate HOME so we never touch the real user config.
	home := t.TempDir()
	t.Setenv("HOME", home)

	// No flag/env/file value: output defaults to auto (table on a
	// terminal, json when piped).
	t.Setenv(EnvOutput, "")
	got, err := Resolve(Flags{})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.Output != "auto" {
		t.Fatalf("expected auto default output, got %q", got.Output)
	}

	// Profile default wins over the built-in default, flag wins over all.
	t.Setenv(EnvOutput, "yaml")
	got, err = Resolve(Flags{})
	if err != nil {
		t.Fatalf("Resolve env: %v", err)
	}
	if got.Output != "yaml" {
		t.Fatalf("env output precedence broken: %q", got.Output)
	}
	got, err = Resolve(Flags{Output: "json"})
	if err != nil {
		t.Fatalf("Resolve flag: %v", err)
	}
	if got.Output != "json" {
		t.Fatalf("flag output precedence broken: %q", got.Output)
	}
}

func TestResolveTLSSettings(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(EnvCACert, "")
	t.Setenv(EnvInsecure, "")
	if err := SaveProfile("default", ProfileUpdate{Server: "https://h", CACert: "ca.pem"}, true); err != nil {
		t.Fatal(err)
	}
	r, err := Resolve(Flags{})
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(r.CACert) || filepath.Base(r.CACert) != "ca.pem" {
		t.Errorf("profile CA must be stored as an absolute path, got %q", r.CACert)
	}
	if r.InsecureSkipTLSVerify {
		t.Error("TLS verification must be on by default")
	}

	t.Setenv(EnvCACert, "/env/ca.pem")
	t.Setenv(EnvInsecure, "true")
	r, _ = Resolve(Flags{})
	if r.CACert != "/env/ca.pem" || !r.InsecureSkipTLSVerify {
		t.Errorf("env must override the profile: %+v", r)
	}
	r, _ = Resolve(Flags{CACert: "/flag/ca.pem"})
	if r.CACert != "/flag/ca.pem" {
		t.Errorf("flag must win, got %q", r.CACert)
	}
}

func TestProfileManagement(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	if err := UseProfile("prod"); err == nil {
		t.Fatal("switching to a profile that does not exist must fail")
	}
	if err := SetProfileValue("prod", "server", "https://prod.example/"); err != nil {
		t.Fatal(err)
	}
	if err := SetProfileValue("prod", "token", "x"); err == nil {
		t.Fatal("tokens must not be settable through config set")
	}
	if err := SaveCredentials("prod", "ch_pat_secret"); err != nil {
		t.Fatal(err)
	}
	if err := UseProfile("prod"); err != nil {
		t.Fatalf("UseProfile: %v", err)
	}
	profiles, err := ListProfiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 || !profiles[0].Current || profiles[0].Server != "https://prod.example" || !profiles[0].HasToken {
		t.Fatalf("unexpected profiles: %+v", profiles)
	}
	cfg, _ := LoadFile()
	if got, _ := ProfileValue(cfg.Profiles["prod"], "server"); got != "https://prod.example" {
		t.Fatalf("server: %q", got)
	}
	if err := SetProfileValue("prod", "server", ""); err != nil {
		t.Fatal(err)
	}
	if err := DeleteProfile("prod"); err != nil {
		t.Fatal(err)
	}
	creds, _ := LoadCredentials()
	if _, ok := creds.Tokens["prod"]; ok {
		t.Fatal("deleting a profile must remove its token")
	}
	if cfg, _ := LoadFile(); cfg.CurrentProfile != "" {
		t.Fatalf("deleting the current profile must reset it, got %q", cfg.CurrentProfile)
	}
}
