package main

import (
	"context"
	"fmt"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/config"
)

// agentCatalog reads an installed agent's model catalog. Tests replace it.
var agentCatalog = func(agent, executable string) (ai.AgentCatalog, error) {
	return ai.ListAgentModels(context.Background(), agent, executable)
}

// findAgents finds the installed agent CLIs. Tests replace it.
var findAgents = ai.FindAgents

func newAIProvider(settings config.AI) (ai.Provider, error) {
	switch {
	case settings.Provider == config.ProviderLlamaCpp:
		return ai.NewOpenAICompat(settings.Endpoint, settings.Model), nil
	case config.IsAgentProvider(settings.Provider):
		provider, err := newAgentProvider(settings)
		if err != nil {
			return nil, err
		}
		return provider, nil
	default:
		return nil, fmt.Errorf("unsupported AI provider %q", settings.Provider)
	}
}

func newAgentProvider(settings config.AI) (*ai.AgentProvider, error) {
	selection, err := resolveAgentSelection(settings)
	if err != nil {
		return nil, err
	}
	return ai.NewAgentProvider(settings.Provider, settings.AgentExecutable, selection)
}

// resolveAgentSelection validates saved agent settings against the installed
// agent's model catalog. Discovery failures and unavailable selections fail
// the operation instead of falling back to another model.
func resolveAgentSelection(settings config.AI) (ai.AgentSelection, error) {
	catalog, err := agentCatalog(settings.Provider, settings.AgentExecutable)
	if err != nil {
		name := ai.AgentName(settings.Provider)
		return ai.AgentSelection{}, fmt.Errorf("read installed %s model catalog: %w; update %s or open Settings", name, err, name)
	}
	return ai.ResolveAgentSelection(settings.Provider, catalog, settings.AgentModel, settings.AgentReasoningEffort)
}
