package config

import (
	"os"
	"path/filepath"
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
