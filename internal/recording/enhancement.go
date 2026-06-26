package recording

import (
	"context"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
)

type EnhanceOptions struct {
	Notes    string
	Feedback string
	Refine   bool
}

// Enhance re-runs AI pipeline over stored meeting transcript and saves result.
func (s Service) Enhance(ctx context.Context, meetingID, notes string) error {
	return s.EnhanceWithOptions(ctx, meetingID, EnhanceOptions{Notes: notes})
}

func (s Service) EnhanceWithOptions(ctx context.Context, meetingID string, options EnhanceOptions) error {
	return s.processing().enhanceStored(ctx, meetingID, options)
}

func (p meetingProcessing) enhanceStored(ctx context.Context, meetingID string, options EnhanceOptions) error {
	meeting, err := p.service.meetings().GetMeeting(meetingID)
	if err != nil {
		return fmt.Errorf("get meeting: %w", err)
	}
	transcript, err := p.storedTranscript(meetingID, meeting.Transcript)
	if err != nil {
		return err
	}
	session := p.service.sessionFor(meeting, audioartifact.Artifacts{})
	if err := session.markProcessing(); err != nil {
		return err
	}
	return p.enhanceStoredSession(ctx, session, transcript, options)
}

func (p meetingProcessing) storedTranscript(meetingID string, saved *string) (string, error) {
	if saved != nil && *saved != "" {
		return *saved, nil
	}
	segments, err := p.service.meetings().GetSegments(meetingID)
	if err != nil {
		return "", fmt.Errorf("get segments: %w", err)
	}
	if len(segments) == 0 {
		return "", fmt.Errorf("no segments found for meeting %s", meetingID)
	}
	return FormatTranscript(segments), nil
}

func (p meetingProcessing) enhanceStoredSession(ctx context.Context, session recordingSession, transcript string, options EnhanceOptions) error {
	if canRefineStored(session.meeting.ExtractionJSON, session.meeting.Summary, options) {
		return p.refineStoredSummary(ctx, session, transcript, options)
	}
	return p.enhanceAndSave(ctx, session, transcript, options)
}

func canRefineStored(extractionJSON, summary *string, options EnhanceOptions) bool {
	return wantsRefinement(options) && filled(extractionJSON) && filled(summary)
}

func wantsRefinement(options EnhanceOptions) bool {
	return options.Refine || strings.TrimSpace(options.Feedback) != ""
}

func filled(value *string) bool {
	return value != nil && strings.TrimSpace(*value) != ""
}

func (p meetingProcessing) refineStoredSummary(ctx context.Context, session recordingSession, transcript string, options EnhanceOptions) error {
	p.printEnhancementStart()
	progress := p.aiProgress()
	if progress != nil {
		progress(ai.Progress{Stage: ai.ProgressRefineNotes, Current: 1, Total: 1})
	}
	extraction, err := ai.DecodeExtractionJSON(*session.meeting.ExtractionJSON)
	if err != nil {
		return session.saveEnhanceFailure(transcript, err)
	}
	summary, err := p.enhancer().RefineNotes(ctx, extraction, *session.meeting.Summary, options.refinementGuidance())
	if err != nil {
		return session.saveEnhanceFailure(transcript, err)
	}
	return p.saveEnhancement(session, extraction, transcript, summary)
}

func (p meetingProcessing) enhanceAndSave(ctx context.Context, session recordingSession, transcript string, options EnhanceOptions) error {
	p.printEnhancementStart()
	runOptions := options.runOptions(previousSummary(session, options), p.aiProgress())
	extraction, summary, err := p.enhancer().RunWithOptions(ctx, transcript, runOptions)
	if err != nil {
		return session.saveEnhanceFailure(transcript, err)
	}
	return p.saveEnhancement(session, extraction, transcript, summary)
}

func (p meetingProcessing) saveEnhancement(session recordingSession, extraction *ai.Extraction, transcript, summary string) error {
	extractionJSON, err := ai.EncodeExtraction(extraction)
	if err != nil {
		return session.saveEnhanceFailure(transcript, err)
	}
	if err := session.saveEnhancement(extraction.Title, transcript, summary, extractionJSON); err != nil {
		return err
	}
	p.printEnhancementResult(summary, len(extraction.ActionItems), session.meeting.ID)
	return nil
}

func (o EnhanceOptions) runOptions(previous string, progress func(ai.Progress)) ai.RunOptions {
	return ai.RunOptions{UserNotes: o.Notes, Feedback: o.Feedback, PreviousNotes: previous, RefineNotes: o.Refine, OnProgress: progress}
}

func (o EnhanceOptions) refinementGuidance() string {
	return ai.RunOptions{UserNotes: o.Notes, Feedback: o.Feedback}.RefinementGuidance()
}

func previousSummary(session recordingSession, options EnhanceOptions) string {
	if !wantsRefinement(options) || !filled(session.meeting.Summary) {
		return ""
	}
	return *session.meeting.Summary
}

func (p meetingProcessing) enhancer() enhancer {
	if p.service.enhancer != nil {
		return p.service.enhancer
	}
	return p.service.Pipeline
}

func (p meetingProcessing) printEnhancementStart() {
	if p.service.Events == nil {
		fmt.Fprintln(p.service.Out, "── Enhancing with AI... ─────────────────")
	}
}

func (p meetingProcessing) aiProgress() func(ai.Progress) {
	if p.service.Events != nil {
		return nil
	}
	return func(progress ai.Progress) { printAIProgress(p.service, progress) }
}

func printAIProgress(s Service, progress ai.Progress) {
	if progress.Total > 1 {
		fmt.Fprintf(s.Out, "● AI %s %d/%d\n", progress.Stage, progress.Current, progress.Total)
		return
	}
	fmt.Fprintf(s.Out, "● AI %s\n", progress.Stage)
}

func (p meetingProcessing) printEnhancementResult(summary string, actionItems int, meetingID string) {
	if p.service.Events == nil {
		printEnhancementResult(p.service, summary, actionItems, meetingID)
	}
}

func printEnhancementResult(s Service, summary string, actionItems int, meetingID string) {
	fmt.Fprintln(s.Out, "\n── Notes ───────────────────────────────")
	fmt.Fprintln(s.Out, summary)
	if actionItems > 0 {
		fmt.Fprintf(s.Out, "\n● %d action items extracted.\n", actionItems)
	}
	fmt.Fprintf(s.Out, "● Saved: %s\n", meetingID)
}
