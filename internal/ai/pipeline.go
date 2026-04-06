package ai

import (
	"context"
	"encoding/json"
	"fmt"
)

type Pipeline struct {
	provider    InferenceProvider
	temperature float64
}

func NewPipeline(provider InferenceProvider, temperature float64) *Pipeline {
	return &Pipeline{provider: provider, temperature: temperature}
}

func (p *Pipeline) Extract(ctx context.Context, transcript string) (*Extraction, error) {
	system, user := Stage1Prompt(transcript)
	req := CompletionRequest{System: system, User: user, Temperature: p.temperature}
	raw, err := p.provider.CompleteJSON(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("extraction failed: %w", err)
	}
	return parseExtraction(raw)
}

func (p *Pipeline) Synthesize(ctx context.Context, extraction *Extraction, userNotes string) (string, error) {
	data, err := json.Marshal(extraction)
	if err != nil {
		return "", fmt.Errorf("marshal extraction: %w", err)
	}
	system, user := Stage2Prompt(string(data), userNotes)
	req := CompletionRequest{System: system, User: user, Temperature: p.temperature}
	result, err := p.provider.Complete(ctx, req)
	if err != nil {
		return "", fmt.Errorf("synthesis failed: %w", err)
	}
	return result, nil
}

func (p *Pipeline) Run(ctx context.Context, transcript string, userNotes string) (*Extraction, string, error) {
	extraction, err := p.Extract(ctx, transcript)
	if err != nil {
		return nil, "", err
	}
	notes, err := p.Synthesize(ctx, extraction, userNotes)
	if err != nil {
		return extraction, "", err
	}
	return extraction, notes, nil
}

func parseExtraction(raw json.RawMessage) (*Extraction, error) {
	var ext Extraction
	if err := json.Unmarshal(raw, &ext); err != nil {
		return nil, fmt.Errorf("parse extraction JSON: %w", err)
	}
	return &ext, nil
}
