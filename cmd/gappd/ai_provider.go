package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/config"
)

// codexCatalog reads the installed Codex model catalog. Tests replace it.
var codexCatalog = func(executable string) ([]ai.CodexModel, error) {
	return ai.ListCodexModels(context.Background(), executable)
}

// providerGeneration is the model and reasoning effort an operation snapshot used.
type providerGeneration struct {
	Model  string
	Effort string
}

func newAIProvider(settings config.AI) (ai.Provider, error) {
	switch settings.Provider {
	case config.ProviderLlamaCpp:
		return ai.NewOpenAICompat(settings.Endpoint, settings.Model), nil
	case config.ProviderCodexExec:
		return newCodexExecProvider(settings)
	default:
		return nil, fmt.Errorf("unsupported AI provider %q", settings.Provider)
	}
}

func newCodexExecProvider(settings config.AI) (ai.Provider, error) {
	selection, err := resolveCodexSelection(settings)
	if err != nil {
		return nil, err
	}
	return ai.NewCodexExec(settings.CodexExecutable, selection.Model, selection.Effort), nil
}

// resolveCodexSelection validates saved Installed Codex settings against the
// installed Codex model catalog. Discovery failures and unavailable selections
// fail the operation instead of falling back to another model.
func resolveCodexSelection(settings config.AI) (ai.CodexSelection, error) {
	settings.CodexModel = strings.TrimSpace(settings.CodexModel)
	settings.CodexReasoningEffort = strings.ToLower(strings.TrimSpace(settings.CodexReasoningEffort))
	models, err := codexCatalog(settings.CodexExecutable)
	if err != nil {
		return ai.CodexSelection{}, fmt.Errorf("read installed Codex model catalog: %w; update Codex or open Settings", err)
	}
	return ai.ResolveCodexSelection(models, settings.CodexModel, settings.CodexReasoningEffort)
}

func providerGenerationFor(provider ai.Provider, settings config.AI) providerGeneration {
	selected, ok := provider.(interface{ CodexSelection() ai.CodexSelection })
	if !ok {
		return providerGeneration{Model: settings.Model}
	}
	selection := selected.CodexSelection()
	return providerGeneration{Model: selection.Model, Effort: selection.Effort}
}
