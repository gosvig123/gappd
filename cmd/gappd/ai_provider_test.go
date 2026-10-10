package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
)

func TestNewAIProviderBuildsCodexExec(t *testing.T) {
	stubCodexCatalog(t, "gpt-5.6-terra", "gpt-5.6-terra", "medium", "medium", "high")
	provider, err := newAIProvider(config.AI{Provider: config.ProviderCodexExec, CodexExecutable: "/opt/codex"})
	if err != nil || provider == nil {
		t.Fatalf("newAIProvider() = %T, %v", provider, err)
	}
	selection := provider.(interface{ CodexSelection() ai.CodexSelection }).CodexSelection()
	if selection != (ai.CodexSelection{Model: "gpt-5.6-terra", Effort: "medium"}) {
		t.Fatalf("selection = %+v", selection)
	}
}

func TestNewAIProviderRejectsUnavailableSavedModel(t *testing.T) {
	stubCodexCatalog(t, "gpt-5.6-terra", "gpt-5.6-terra", "medium", "medium")
	settings := config.AI{Provider: config.ProviderCodexExec, CodexExecutable: "/opt/codex", CodexModel: "gpt-retired"}
	provider, err := newAIProvider(settings)
	if provider != nil || err == nil || !strings.Contains(err.Error(), "not in the installed Codex model catalog") {
		t.Fatalf("newAIProvider() = %v, %v", provider, err)
	}
}

func TestNewAIProviderFailsWhenCatalogDiscoveryFails(t *testing.T) {
	stubCodexCatalogError(t, "catalog offline")
	provider, err := newAIProvider(config.AI{Provider: config.ProviderCodexExec, CodexExecutable: "/opt/codex"})
	if provider != nil || err == nil || !strings.Contains(err.Error(), "read installed Codex model catalog") {
		t.Fatalf("newAIProvider() = %v, %v", provider, err)
	}
}

// stubCodexCatalog replaces catalog discovery with one model for the test.
func stubCodexCatalog(t *testing.T, id, displayName, defaultEffort string, efforts ...string) {
	t.Helper()
	stubCodexCatalogModels(t, []ai.CodexModel{{ID: id, DisplayName: displayName, DefaultReasoningEffort: defaultEffort, ReasoningEfforts: efforts}})
}

func stubCodexCatalogModels(t *testing.T, models []ai.CodexModel) {
	t.Helper()
	previous := codexCatalog
	codexCatalog = func(string) ([]ai.CodexModel, error) { return models, nil }
	t.Cleanup(func() { codexCatalog = previous })
}

func stubCodexCatalogError(t *testing.T, message string) {
	t.Helper()
	previous := codexCatalog
	codexCatalog = func(string) ([]ai.CodexModel, error) { return nil, errors.New(message) }
	t.Cleanup(func() { codexCatalog = previous })
}

func TestProcessingPipelineSkipsAIForLocalCapabilities(t *testing.T) {
	cfg := config.Config{AI: config.AI{Provider: config.ProviderCodexExec}}
	pipeline, err := processingPipeline(cfg, meetingprocessing.CapabilityTranscription)
	if err != nil || pipeline != nil {
		t.Fatalf("processingPipeline() = %v, %v", pipeline, err)
	}
}

func TestProcessingPipelinePreflightsCodex(t *testing.T) {
	stubCodexCatalog(t, "gpt-5.6-terra", "GPT-5.6-Terra", "medium", "low", "medium", "high")
	executable := filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\necho moved-or-logged-out >&2\nexit 9\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{AI: config.AI{Provider: config.ProviderCodexExec, CodexExecutable: executable}}
	pipeline, err := processingPipeline(cfg, meetingprocessing.CapabilitySummarization)
	if pipeline != nil || err == nil || !strings.Contains(err.Error(), "preflight Installed Codex before summarization") {
		t.Fatalf("processingPipeline() = %v, %v", pipeline, err)
	}
}

func TestNewAIProviderKeepsLocalDefault(t *testing.T) {
	provider, err := newAIProvider(config.AI{Provider: config.ProviderLlamaCpp, Endpoint: "http://local", Model: "model"})
	if err != nil || provider == nil {
		t.Fatalf("newAIProvider() = %T, %v", provider, err)
	}
}
