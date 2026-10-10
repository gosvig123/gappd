package ai

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// DefaultCodexModel and DefaultCodexReasoningEffort are the app defaults for
// Installed Codex. They stay valid only when the installed Codex model catalog
// still advertises the pair; discovery failures never fall back to another model.
const (
	DefaultCodexModel           = "gpt-5.6-terra"
	DefaultCodexReasoningEffort = "medium"

	codexCatalogLimit = 2 * 1024 * 1024
)

var codexCatalogTimeout = 20 * time.Second

// CodexModel is one selectable model from the installed Codex model catalog.
type CodexModel struct {
	ID                     string
	DisplayName            string
	DefaultReasoningEffort string
	ReasoningEfforts       []string
	IsDefault              bool
}

// CodexSelection is the resolved model and reasoning effort for Codex calls.
type CodexSelection struct {
	Model  string
	Effort string
}

// ResolveCodexSelection maps saved configuration onto the installed catalog.
// An unset model resolves to the required default pair. An explicit model keeps
// its saved effort, or uses the catalog default effort when none was saved.
// Anything the catalog does not advertise is an error, never a silent fallback.
func ResolveCodexSelection(models []CodexModel, savedModel, savedEffort string) (CodexSelection, error) {
	model, effort := strings.TrimSpace(savedModel), strings.TrimSpace(savedEffort)
	if model == "" {
		return defaultCodexSelection(models)
	}
	catalogModel := findCodexModel(models, model)
	if catalogModel == nil {
		return CodexSelection{}, fmt.Errorf("Codex model %q is not in the installed Codex model catalog; choose a model in Settings", model)
	}
	if effort == "" {
		return CodexSelection{Model: model, Effort: catalogModel.DefaultReasoningEffort}, nil
	}
	if !codexModelSupportsEffort(catalogModel, effort) {
		return CodexSelection{}, fmt.Errorf("Codex model %q does not support reasoning effort %q; choose a supported effort in Settings", model, effort)
	}
	return CodexSelection{Model: model, Effort: effort}, nil
}

func defaultCodexSelection(models []CodexModel) (CodexSelection, error) {
	catalogModel := findCodexModel(models, DefaultCodexModel)
	if catalogModel == nil || !codexModelSupportsEffort(catalogModel, DefaultCodexReasoningEffort) {
		return CodexSelection{}, fmt.Errorf("installed Codex model catalog does not advertise %s with %s reasoning effort; choose a model in Settings", DefaultCodexModel, DefaultCodexReasoningEffort)
	}
	return CodexSelection{Model: DefaultCodexModel, Effort: DefaultCodexReasoningEffort}, nil
}

func findCodexModel(models []CodexModel, id string) *CodexModel {
	for index := range models {
		if models[index].ID == id {
			return &models[index]
		}
	}
	return nil
}

func codexModelSupportsEffort(model *CodexModel, effort string) bool {
	for _, supported := range model.ReasoningEfforts {
		if supported == effort {
			return true
		}
	}
	return false
}

// ListCodexModels reads the installed Codex model catalog over the documented
// app-server stdio protocol. The call is read-only, bounded, and never writes
// Codex or Gappd configuration.
func ListCodexModels(ctx context.Context, executable string) ([]CodexModel, error) {
	ctx, cancel := context.WithTimeout(ctx, codexCatalogTimeout)
	defer cancel()
	session, err := startCodexCatalog(executable)
	if err != nil {
		return nil, err
	}
	defer session.close()
	done := make(chan codexCatalogResult, 1)
	go func() {
		models, err := session.readModels()
		done <- codexCatalogResult{models: models, err: err}
	}()
	select {
	case result := <-done:
		return result.models, result.err
	case <-ctx.Done():
		return nil, fmt.Errorf("Codex model catalog timed out after %s; update Codex or retry", codexCatalogTimeout)
	}
}

type codexCatalogResult struct {
	models []CodexModel
	err    error
}

func convertCodexModel(raw codexCatalogModel) (CodexModel, bool) {
	id := strings.TrimSpace(raw.Model)
	if id == "" {
		id = strings.TrimSpace(raw.ID)
	}
	if raw.Hidden || id == "" {
		return CodexModel{}, false
	}
	displayName := strings.TrimSpace(raw.DisplayName)
	if displayName == "" {
		displayName = id
	}
	return CodexModel{
		ID:                     id,
		DisplayName:            displayName,
		DefaultReasoningEffort: strings.TrimSpace(raw.DefaultReasoningEffort),
		ReasoningEfforts:       codexEfforts(raw),
		IsDefault:              raw.IsDefault,
	}, true
}

func codexEfforts(raw codexCatalogModel) []string {
	efforts := make([]string, 0, len(raw.SupportedReasoningEfforts))
	for _, option := range raw.SupportedReasoningEfforts {
		if effort := strings.TrimSpace(option.ReasoningEffort); effort != "" {
			efforts = append(efforts, effort)
		}
	}
	return efforts
}

func convertCodexModels(raw []codexCatalogModel) []CodexModel {
	models := make([]CodexModel, 0, len(raw))
	for _, entry := range raw {
		if model, ok := convertCodexModel(entry); ok {
			models = append(models, model)
		}
	}
	return models
}
