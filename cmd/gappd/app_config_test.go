package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/gappd-dev/gappd/internal/config"
)

func TestManagedLocalAISetupRepairsLegacyOllamaConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	writeAppConfigFile(t, home, legacyOllamaConfig())

	cfg, err := loadManagedLocalAIRepairConfig()
	if err != nil {
		t.Fatalf("loadManagedLocalAIRepairConfig() error = %v", err)
	}
	if err := applyManagedLocalAI(&cfg, config.DefaultLlamaCppEndpoint, config.DefaultLlamaCppModel, 0, false); err != nil {
		t.Fatalf("applyManagedLocalAI() error = %v", err)
	}
	if err := config.Save(cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	saved, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	assertManagedLocalAIConfig(t, saved, home)
}

func legacyOllamaConfig() string {
	return "db_path = \"~/.gappd/legacy.sqlite\"\n\n[ai]\nprovider = \"ollama\"\nmodel = \"llama3.1:8b\"\nendpoint = \"http://localhost:11434\"\ntemperature = 0.3\nmanaged = true\n"
}

func writeAppConfigFile(t *testing.T, home, content string) {
	t.Helper()
	configDir := filepath.Join(home, ".gappd")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.toml"), []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
}

func assertManagedLocalAIConfig(t *testing.T, cfg config.Config, home string) {
	t.Helper()
	if cfg.DBPath != filepath.Join(home, ".gappd", "legacy.sqlite") {
		t.Fatalf("DBPath = %q", cfg.DBPath)
	}
	if cfg.AI.Provider != config.ProviderLlamaCpp || !cfg.AI.Managed {
		t.Fatalf("AI provider/managed = %q/%v", cfg.AI.Provider, cfg.AI.Managed)
	}
	if cfg.AI.Endpoint != config.DefaultLlamaCppEndpoint || cfg.AI.Model != config.DefaultLlamaCppModel {
		t.Fatalf("AI endpoint/model = %q/%q", cfg.AI.Endpoint, cfg.AI.Model)
	}
}
