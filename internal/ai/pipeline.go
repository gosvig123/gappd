package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type ProgressStage string

const (
	ProgressExtract          ProgressStage = "extract"
	ProgressRefineExtraction ProgressStage = "refine_extraction"
	ProgressSynthesize       ProgressStage = "synthesize"
	ProgressRefineNotes      ProgressStage = "refine_notes"

	structuredTemperature     = 0
	maxExtractionTokens       = 4096
	maxRefineExtractionTokens = 8192
	maxNotesTokens            = 4096
)

type Progress struct {
	Stage   ProgressStage
	Current int
	Total   int
}

type RunOptions struct {
	UserNotes     string
	Feedback      string
	PreviousNotes string
	RefineNotes   bool
	OnProgress    func(Progress)
	Language      string
}

type Pipeline struct {
	provider    Provider
	temperature float64
}

func NewPipeline(provider Provider, temperature float64) *Pipeline {
	return &Pipeline{provider: provider, temperature: temperature}
}

func (p *Pipeline) Extract(ctx context.Context, transcript string) (*Extraction, error) {
	return p.extractVerified(ctx, transcript, nil, "", "")
}

func (p *Pipeline) ExtractLong(ctx context.Context, transcript string) (*Extraction, error) {
	return p.extractVerified(ctx, transcript, nil, "", "")
}

func (p *Pipeline) extractLong(ctx context.Context, transcript string, progress func(Progress), language, relevance string) (*Extraction, error) {
	chunks := transcriptChunks(transcript)
	if len(chunks) > maxTranscriptChunks {
		return nil, fmt.Errorf("transcript too large: %d chunks exceeds limit %d", len(chunks), maxTranscriptChunks)
	}
	if len(chunks) == 1 {
		return p.extractChunk(ctx, transcript, language)
	}
	extractions, err := p.extractChunks(ctx, chunks, progress, language)
	if err != nil {
		return nil, err
	}
	return p.refineMergedExtraction(ctx, extractions, progress, language, relevance)
}

func (p *Pipeline) extractChunks(ctx context.Context, chunks []string, progress func(Progress), language string) ([]*Extraction, error) {
	extractions := make([]*Extraction, 0, len(chunks))
	for index, chunk := range chunks {
		emitProgress(progress, ProgressExtract, index+1, len(chunks))
		extraction, err := p.extractChunk(ctx, chunk, language)
		if err != nil {
			return nil, err
		}
		extractions = append(extractions, extraction)
	}
	return extractions, nil
}

func (p *Pipeline) refineMergedExtraction(ctx context.Context, extractions []*Extraction, progress func(Progress), language, relevance string) (*Extraction, error) {
	merged := mergeExtractions(extractions)
	emitProgress(progress, ProgressRefineExtraction, 1, 1)
	return p.refineExtraction(ctx, merged, relevance, language)
}

func (p *Pipeline) extractChunk(ctx context.Context, transcript string, language string) (*Extraction, error) {
	system, user := Stage1Prompt(transcript, language)
	req := CompletionRequest{System: system, User: user, Temperature: structuredTemperature, JSONSchema: ExtractionJSONSchema(), MaxTokens: maxExtractionTokens}
	raw, err := p.provider.CompleteJSON(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("extraction failed: %w", err)
	}
	extraction, err := parseExtraction(raw)
	if err != nil {
		return nil, err
	}
	return groundExtraction(extraction, transcript), nil
}

func (p *Pipeline) Synthesize(ctx context.Context, extraction *Extraction, userNotes string) (string, error) {
	return p.synthesize(ctx, extraction, userNotes, "")
}

func (p *Pipeline) synthesize(ctx context.Context, extraction *Extraction, userNotes string, language string) (string, error) {
	data, err := json.Marshal(extraction)
	if err != nil {
		return "", fmt.Errorf("marshal extraction: %w", err)
	}
	system, user := Stage2Prompt(string(data), userNotes, language)
	req := CompletionRequest{System: system, User: user, Temperature: p.temperature, MaxTokens: maxNotesTokens}
	result, err := p.provider.Complete(ctx, req)
	if err != nil {
		return "", fmt.Errorf("synthesis failed: %w", err)
	}
	return normalizeNotesMarkdown(result, extraction), nil
}

func (p *Pipeline) Run(ctx context.Context, transcript string, userNotes string) (*Extraction, string, error) {
	return p.RunWithOptions(ctx, transcript, RunOptions{UserNotes: userNotes})
}

func (p *Pipeline) RunWithOptions(ctx context.Context, transcript string, options RunOptions) (*Extraction, string, error) {
	extraction, err := p.extractVerified(ctx, transcript, options.OnProgress, options.Language, options.UserNotes)
	if err != nil {
		return nil, "", err
	}
	notes, err := p.notes(ctx, extraction, options)
	if err != nil {
		return extraction, notes, err
	}
	return extraction, notes, nil
}

func (p *Pipeline) notes(ctx context.Context, extraction *Extraction, options RunOptions) (string, error) {
	draft, err := p.draftNotes(ctx, extraction, options)
	if err != nil {
		return "", err
	}
	if !options.wantsNoteRefinement() {
		return draft, nil
	}
	emitProgress(options.OnProgress, ProgressRefineNotes, 1, 1)
	return p.RefineNotes(ctx, extraction, draft, options.RefinementGuidance(), options.Language)
}

func (p *Pipeline) draftNotes(ctx context.Context, extraction *Extraction, options RunOptions) (string, error) {
	if options.PreviousNotes != "" {
		return options.PreviousNotes, nil
	}
	emitProgress(options.OnProgress, ProgressSynthesize, 1, 1)
	return p.synthesize(ctx, extraction, options.UserNotes, options.Language)
}

func (o RunOptions) wantsNoteRefinement() bool {
	return o.RefineNotes || o.Feedback != "" || o.PreviousNotes != ""
}

// RefinementGuidance combines freeform notes and feedback for note rewrite prompts.
func (o RunOptions) RefinementGuidance() string {
	parts := []string{}
	if o.UserNotes != "" {
		parts = append(parts, "User notes:\n"+o.UserNotes)
	}
	if o.Feedback != "" {
		parts = append(parts, "Feedback:\n"+o.Feedback)
	}
	return strings.Join(parts, "\n\n")
}

func emitProgress(progress func(Progress), stage ProgressStage, current, total int) {
	if progress != nil {
		progress(Progress{Stage: stage, Current: current, Total: total})
	}
}

func parseExtraction(raw json.RawMessage) (*Extraction, error) {
	var ext Extraction
	if err := json.Unmarshal(raw, &ext); err != nil {
		return nil, fmt.Errorf("parse extraction JSON: %w", err)
	}
	return &ext, nil
}
