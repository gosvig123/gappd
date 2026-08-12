package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
)

func TestNewAIProviderBuildsCodexExec(t *testing.T) {
	provider, err := newAIProvider(config.AI{Provider: config.ProviderCodexExec, CodexExecutable: "/opt/codex"})
	if err != nil || provider == nil {
		t.Fatalf("newAIProvider() = %T, %v", provider, err)
	}
}

func TestProcessingPipelineSkipsAIForLocalCapabilities(t *testing.T) {
	cfg := config.Config{AI: config.AI{Provider: config.ProviderCodexExec}}
	pipeline, err := processingPipeline(cfg, meetingprocessing.CapabilityTranscription)
	if err != nil || pipeline != nil {
		t.Fatalf("processingPipeline() = %v, %v", pipeline, err)
	}
}

func TestProcessingPipelinePreflightsCodex(t *testing.T) {
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
