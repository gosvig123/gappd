package ai

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const codexCatalogLimit = 2 * 1024 * 1024

var codexCatalogTimeout = 20 * time.Second

// listCodexModels reads the installed Codex model catalog over the documented
// app-server stdio protocol. The call is read-only, bounded, and never writes
// Codex or Gappd configuration.
func listCodexModels(ctx context.Context, c cli) ([]AgentModel, error) {
	ctx, cancel := context.WithTimeout(ctx, codexCatalogTimeout)
	defer cancel()
	session, err := startCodexCatalog(c)
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
	models []AgentModel
	err    error
}

func convertCodexModel(raw codexCatalogModel) (AgentModel, bool) {
	id := strings.TrimSpace(raw.Model)
	if id == "" {
		id = strings.TrimSpace(raw.ID)
	}
	if raw.Hidden || id == "" {
		return AgentModel{}, false
	}
	displayName := strings.TrimSpace(raw.DisplayName)
	if displayName == "" {
		displayName = id
	}
	return AgentModel{
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

func convertCodexModels(raw []codexCatalogModel) []AgentModel {
	models := make([]AgentModel, 0, len(raw))
	for _, entry := range raw {
		if model, ok := convertCodexModel(entry); ok {
			models = append(models, model)
		}
	}
	return models
}
