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
	provider, err := newAIProvider(config.AI{Provider: config.ProviderCodexExec, AgentExecutable: "/opt/codex"})
	if err != nil || provider == nil {
		t.Fatalf("newAIProvider() = %T, %v", provider, err)
	}
	selection := provider.(*ai.AgentProvider).Selection()
	if selection != (ai.AgentSelection{Model: "gpt-5.6-terra", Effort: "medium"}) {
		t.Fatalf("selection = %+v", selection)
	}
}

func TestNewAIProviderRejectsUnavailableSavedModel(t *testing.T) {
	stubCodexCatalog(t, "gpt-5.6-terra", "gpt-5.6-terra", "medium", "medium")
	settings := config.AI{Provider: config.ProviderCodexExec, AgentExecutable: "/opt/codex", AgentModel: "gpt-retired"}
	provider, err := newAIProvider(settings)
	if provider != nil || err == nil || !strings.Contains(err.Error(), "not in the installed Codex model catalog") {
		t.Fatalf("newAIProvider() = %v, %v", provider, err)
	}
}

func TestNewAIProviderFailsWhenCatalogDiscoveryFails(t *testing.T) {
	stubCodexCatalogError(t, "catalog offline")
	provider, err := newAIProvider(config.AI{Provider: config.ProviderCodexExec, AgentExecutable: "/opt/codex"})
	if provider != nil || err == nil || !strings.Contains(err.Error(), "read installed Codex model catalog") {
		t.Fatalf("newAIProvider() = %v, %v", provider, err)
	}
}

// stubCodexCatalog replaces catalog discovery with one model for the test.
func stubCodexCatalog(t *testing.T, id, displayName, defaultEffort string, efforts ...string) {
	t.Helper()
	stubCodexCatalogModels(t, []ai.AgentModel{{ID: id, DisplayName: displayName, DefaultReasoningEffort: defaultEffort, ReasoningEfforts: efforts}})
}

func stubCodexCatalogModels(t *testing.T, models []ai.AgentModel) {
	t.Helper()
	previous := agentCatalog
	agentCatalog = func(string, string) (ai.AgentCatalog, error) {
		return ai.AgentCatalog{Models: models, DefaultModel: ai.DefaultCodexModel, DefaultReasoningEffort: ai.DefaultCodexReasoningEffort}, nil
	}
	t.Cleanup(func() { agentCatalog = previous })
}

func stubCodexCatalogError(t *testing.T, message string) {
	t.Helper()
	previous := agentCatalog
	agentCatalog = func(string, string) (ai.AgentCatalog, error) { return ai.AgentCatalog{}, errors.New(message) }
	t.Cleanup(func() { agentCatalog = previous })
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
	cfg := config.Config{AI: config.AI{Provider: config.ProviderCodexExec, AgentExecutable: executable}}
	pipeline, err := processingPipeline(cfg, meetingprocessing.CapabilitySummarization)
	if pipeline != nil || err == nil || !strings.Contains(err.Error(), "preflight Codex before summarization") {
		t.Fatalf("processingPipeline() = %v, %v", pipeline, err)
	}
}

func TestNewAIProviderKeepsLocalDefault(t *testing.T) {
	provider, err := newAIProvider(config.AI{Provider: config.ProviderLlamaCpp, Endpoint: "http://local", Model: "model"})
	if err != nil || provider == nil {
		t.Fatalf("newAIProvider() = %T, %v", provider, err)
	}
}
