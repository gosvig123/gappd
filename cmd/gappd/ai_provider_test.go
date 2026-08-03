package main

import (
	"errors"
	"testing"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
)

func TestNewAIProviderRequiresPiBridgeConfiguration(t *testing.T) {
	t.Setenv(ai.PiBridgeURLEnv, "")
	t.Setenv(ai.PiBridgeTokenEnv, "")
	_, err := newAIProvider(config.AI{Provider: config.ProviderPi})
	if !errors.Is(err, ai.ErrConfigurationRequired) {
		t.Fatalf("newAIProvider() error = %v", err)
	}
}

func TestProcessingPipelineSkipsAIForLocalCapabilities(t *testing.T) {
	cfg := config.Config{AI: config.AI{Provider: config.ProviderPi}}
	pipeline, err := processingPipeline(cfg, meetingprocessing.CapabilityTranscription)
	if err != nil || pipeline != nil {
		t.Fatalf("processingPipeline() = %v, %v", pipeline, err)
	}
}

func TestNewAIProviderKeepsLocalDefault(t *testing.T) {
	provider, err := newAIProvider(config.AI{Provider: config.ProviderLlamaCpp, Endpoint: "http://local", Model: "model"})
	if err != nil || provider == nil {
		t.Fatalf("newAIProvider() = %T, %v", provider, err)
	}
}
