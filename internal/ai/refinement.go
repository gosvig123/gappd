package ai

import (
	"context"
	"fmt"
)

func (p *Pipeline) RefineExtraction(ctx context.Context, extraction *Extraction) (*Extraction, error) {
	data, err := EncodeExtraction(extraction)
	if err != nil {
		return nil, err
	}
	system, user := Stage1RefinePrompt(data)
	req := CompletionRequest{System: system, User: user, Temperature: p.temperature}
	raw, err := p.ollama.CompleteJSON(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("refine extraction failed: %w", err)
	}
	refined, err := parseExtraction(raw)
	if err != nil {
		return nil, err
	}
	return boundExtraction(refined), nil
}

func (p *Pipeline) RefineNotes(ctx context.Context, extraction *Extraction, draft string, feedback string) (string, error) {
	data, err := EncodeExtraction(extraction)
	if err != nil {
		return "", err
	}
	system, user := Stage3Prompt(data, draft, feedback)
	req := CompletionRequest{System: system, User: user, Temperature: p.temperature}
	result, err := p.ollama.Complete(ctx, req)
	if err != nil {
		return "", fmt.Errorf("refine notes failed: %w", err)
	}
	return result, nil
}
