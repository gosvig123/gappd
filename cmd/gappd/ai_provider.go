package main

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/config"
)

func newAIProvider(settings config.AI) (ai.Provider, error) {
	switch settings.Provider {
	case config.ProviderLlamaCpp:
		return ai.NewOpenAICompat(settings.Endpoint, settings.Model), nil
	case config.ProviderCodexExec:
		return ai.NewCodexExec(settings.CodexExecutable, settings.CodexModel), nil
	default:
		return nil, fmt.Errorf("unsupported AI provider %q", settings.Provider)
	}
}
