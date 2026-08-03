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
	System      string          `json:"system"`
	User        string          `json:"user"`
	Temperature float64         `json:"temperature"`
	JSONSchema  json.RawMessage `json:"jsonSchema,omitempty"`
	MaxTokens   int             `json:"maxTokens"`
}
