package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type CompletionRequest struct {
	System      string
	User        string
	Temperature float64
}

type ProgressStage string

const (
	ProgressExtract          ProgressStage = "extract"
	ProgressRefineExtraction ProgressStage = "refine_extraction"
	ProgressSynthesize       ProgressStage = "synthesize"
	ProgressRefineNotes      ProgressStage = "refine_notes"
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
}

type Pipeline struct {
	ollama      *OllamaProvider
	temperature float64
}

func NewPipeline(ollama *OllamaProvider, temperature float64) *Pipeline {
	return &Pipeline{ollama: ollama, temperature: temperature}
}

func (p *Pipeline) Extract(ctx context.Context, transcript string) (*Extraction, error) {
	return p.extractChunk(ctx, transcript)
}

func (p *Pipeline) ExtractLong(ctx context.Context, transcript string) (*Extraction, error) {
	return p.extractLong(ctx, transcript, nil)
}

func (p *Pipeline) extractLong(ctx context.Context, transcript string, progress func(Progress)) (*Extraction, error) {
	chunks := transcriptChunks(transcript)
	if len(chunks) > maxTranscriptChunks {
		return nil, fmt.Errorf("transcript too large: %d chunks exceeds limit %d", len(chunks), maxTranscriptChunks)
	}
	if len(chunks) == 1 {
		return p.Extract(ctx, transcript)
	}
	extractions, err := p.extractChunks(ctx, chunks, progress)
	if err != nil {
		return nil, err
	}
	return p.refineMergedExtraction(ctx, extractions, progress)
}

func (p *Pipeline) extractChunks(ctx context.Context, chunks []string, progress func(Progress)) ([]*Extraction, error) {
	extractions := make([]*Extraction, 0, len(chunks))
	for index, chunk := range chunks {
		emitProgress(progress, ProgressExtract, index+1, len(chunks))
		extraction, err := p.extractChunk(ctx, chunk)
		if err != nil {
			return nil, err
		}
		extractions = append(extractions, extraction)
	}
	return extractions, nil
}

func (p *Pipeline) refineMergedExtraction(ctx context.Context, extractions []*Extraction, progress func(Progress)) (*Extraction, error) {
	merged := mergeExtractions(extractions)
	emitProgress(progress, ProgressRefineExtraction, 1, 1)
	return p.RefineExtraction(ctx, merged)
}

func (p *Pipeline) extractChunk(ctx context.Context, transcript string) (*Extraction, error) {
	system, user := Stage1Prompt(transcript)
	req := CompletionRequest{System: system, User: user, Temperature: p.temperature}
	raw, err := p.ollama.CompleteJSON(ctx, req)
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
	result, err := p.ollama.Complete(ctx, req)
	if err != nil {
		return "", fmt.Errorf("synthesis failed: %w", err)
	}
	return result, nil
}

func (p *Pipeline) Run(ctx context.Context, transcript string, userNotes string) (*Extraction, string, error) {
	return p.RunWithOptions(ctx, transcript, RunOptions{UserNotes: userNotes})
}

func (p *Pipeline) RunWithOptions(ctx context.Context, transcript string, options RunOptions) (*Extraction, string, error) {
	extraction, err := p.extractLong(ctx, transcript, options.OnProgress)
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
	return p.RefineNotes(ctx, extraction, draft, options.RefinementGuidance())
}

func (p *Pipeline) draftNotes(ctx context.Context, extraction *Extraction, options RunOptions) (string, error) {
	if options.PreviousNotes != "" {
		return options.PreviousNotes, nil
	}
	emitProgress(options.OnProgress, ProgressSynthesize, 1, 1)
	return p.Synthesize(ctx, extraction, options.UserNotes)
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
