package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadReturnsDefaultsWhenConfigMissing(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	wantDBPath := filepath.Join(home, ".gappd", "db.sqlite")
	if cfg.DBPath != wantDBPath {
		t.Fatalf("cfg.DBPath = %q, want %q", cfg.DBPath, wantDBPath)
	}
	if cfg.AI.Provider != "ollama" {
		t.Fatalf("cfg.AI.Provider = %q, want %q", cfg.AI.Provider, "ollama")
	}
}

func TestLoadRejectsUnknownKeys(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	path := writeConfigFile(t, home, "mystery = true\n")
	_, err := Load()
	if err == nil {
		t.Fatal("Load error = nil, want error")
	}
	if !strings.Contains(err.Error(), "unknown config keys in "+path) {
		t.Fatalf("Load error = %q, want unknown key context", err)
	}
	if !strings.Contains(err.Error(), "mystery") {
		t.Fatalf("Load error = %q, want unknown key name", err)
	}
}

func TestLoadToleratesGoogleCalendarConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	writeConfigFile(t, home, "[google]\nclient_id = \"id\"\nclient_secret = \"secret\"\ntoken_path = \"token.json\"\n")
	if _, err := Load(); err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
}

func TestLoadExpandsTildeDBPath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	writeConfigFile(t, home, "db_path = \"~/.gappd/custom.sqlite\"\n")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	want := filepath.Join(home, ".gappd", "custom.sqlite")
	if cfg.DBPath != want {
		t.Fatalf("cfg.DBPath = %q, want %q", cfg.DBPath, want)
	}
}

func writeConfigFile(t *testing.T, home, content string) string {
	t.Helper()
	configDir := filepath.Join(home, ".gappd")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	path := filepath.Join(configDir, "config.toml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}
	return path
}
