package ai

import (
	"context"
	"encoding/json"
)

type Provider interface {
	Complete(ctx context.Context, req CompletionRequest) (string, error)
	CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error)
	Available() error
}

type CompletionRequest struct {
	System      string
	User        string
	Temperature float64
	JSONSchema  json.RawMessage
	MaxTokens   int
}
