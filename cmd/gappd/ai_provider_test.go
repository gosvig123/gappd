package main

import (
	"errors"
	"testing"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/config"
)

func TestNewAIProviderRequiresPiBridgeConfiguration(t *testing.T) {
	t.Setenv(ai.PiBridgeURLEnv, "")
	t.Setenv(ai.PiBridgeTokenEnv, "")
	_, err := newAIProvider(config.AI{Provider: config.ProviderPi})
	if !errors.Is(err, ai.ErrConfigurationRequired) {
		t.Fatalf("newAIProvider() error = %v", err)
	}
}

func TestNewAIProviderKeepsLocalDefault(t *testing.T) {
	provider, err := newAIProvider(config.AI{Provider: config.ProviderLlamaCpp, Endpoint: "http://local", Model: "model"})
	if err != nil || provider == nil {
		t.Fatalf("newAIProvider() = %T, %v", provider, err)
	}
}
