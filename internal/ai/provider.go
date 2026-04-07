package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/grn-dev/grn/internal/config"
)

type CompletionRequest struct {
	System      string
	User        string
	Temperature float64
}

type InferenceProvider interface {
	Complete(ctx context.Context, req CompletionRequest) (string, error)
	CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error)
	Available() error
}

func NewProvider(cfg config.AI) (InferenceProvider, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Provider)) {
	case "ollama":
		return NewOllama(cfg.Endpoint, cfg.Model), nil
	default:
		return nil, fmt.Errorf("unsupported AI provider %q (only %q is implemented)", cfg.Provider, "ollama")
	}
}
