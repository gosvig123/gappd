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

	wantDBPath := filepath.Join(home, ".grn", "db.sqlite")
	if cfg.DBPath != wantDBPath {
		t.Fatalf("cfg.DBPath = %q, want %q", cfg.DBPath, wantDBPath)
	}
	if cfg.Audio.Backend != "screencapturekit" {
		t.Fatalf("cfg.Audio.Backend = %q, want %q", cfg.Audio.Backend, "screencapturekit")
	}
	if cfg.Transcription.Engine != "whisper-local" {
		t.Fatalf("cfg.Transcription.Engine = %q, want %q", cfg.Transcription.Engine, "whisper-local")
	}
	if cfg.AI.Provider != "ollama" {
		t.Fatalf("cfg.AI.Provider = %q, want %q", cfg.AI.Provider, "ollama")
	}
}

func TestLoadRejectsUnknownKeys(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	configDir := filepath.Join(home, ".grn")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	path := filepath.Join(configDir, "config.toml")
	if err := os.WriteFile(path, []byte("mystery = true\n"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

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

func TestLoadExpandsTildeDBPath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	configDir := filepath.Join(home, ".grn")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	path := filepath.Join(configDir, "config.toml")
	if err := os.WriteFile(path, []byte("db_path = \"~/.grn/custom.sqlite\"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	want := filepath.Join(home, ".grn", "custom.sqlite")
	if cfg.DBPath != want {
		t.Fatalf("cfg.DBPath = %q, want %q", cfg.DBPath, want)
	}
}
