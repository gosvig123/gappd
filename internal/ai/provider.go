package ai

import (
	"context"
	"encoding/json"
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
