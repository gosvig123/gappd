package ai

import (
	"context"
	"fmt"
)

func (p *Pipeline) RefineExtraction(ctx context.Context, extraction *Extraction) (*Extraction, error) {
	return p.refineExtraction(ctx, extraction, "", "")
}

func (p *Pipeline) refineExtraction(ctx context.Context, extraction *Extraction, relevance, language string) (*Extraction, error) {
	data, err := EncodeExtraction(extraction)
	if err != nil {
		return nil, err
	}
	system, user := Stage1RefinePrompt(data, relevance, language)
	req := CompletionRequest{System: system, User: user, Temperature: structuredTemperature, JSONSchema: ExtractionJSONSchema(), MaxTokens: maxRefineExtractionTokens}
	raw, err := p.provider.CompleteJSON(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("refine extraction failed: %w", err)
	}
	refined, err := parseExtraction(raw)
	if err != nil {
		return nil, err
	}
	return boundExtraction(requireEvidence(refined)), nil
}

func (p *Pipeline) RefineNotes(ctx context.Context, extraction *Extraction, draft string, feedback string, language string) (string, error) {
	data, err := EncodeExtraction(extraction)
	if err != nil {
		return "", err
	}
	system, user := Stage3Prompt(data, draft, feedback, language)
	req := CompletionRequest{System: system, User: user, Temperature: p.temperature, MaxTokens: maxNotesTokens}
	result, err := p.provider.Complete(ctx, req)
	if err != nil {
		return "", fmt.Errorf("refine notes failed: %w", err)
	}
	return normalizeNotesMarkdown(result, extraction), nil
}
