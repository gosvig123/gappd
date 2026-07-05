package recording

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
)

type EnhanceOptions struct {
	Notes    string
	Feedback string
	Refine   bool
	Language string
}

// Enhance re-runs AI pipeline over stored meeting transcript and saves result.
func (s Service) Enhance(ctx context.Context, meetingID, notes string) error {
	return s.EnhanceWithOptions(ctx, meetingID, EnhanceOptions{Notes: notes})
}

func (s Service) EnhanceWithOptions(ctx context.Context, meetingID string, options EnhanceOptions) error {
	return s.processing().enhanceStored(ctx, meetingID, options)
}

func (p meetingProcessing) enhanceStored(ctx context.Context, meetingID string, options EnhanceOptions) error {
	meeting, err := p.store.GetMeeting(meetingID)
	if err != nil {
		return fmt.Errorf("get meeting: %w", err)
	}
	transcript, err := p.storedTranscript(meetingID, meeting.Transcript)
	if err != nil {
		return err
	}
	session := p.sessionFor(meeting, audioartifact.Artifacts{})
	if err := p.markProcessing(session); err != nil {
		return err
	}
	return p.enhanceStoredSession(ctx, session, transcript, options)
}

func (p meetingProcessing) markProcessing(session recordingSession) error {
	db.LifecycleFor(session.meeting).ProcessingStarted(nowUTC())
	if err := p.store.UpdateMeeting(session.meeting); err != nil {
		return fmt.Errorf("mark meeting processing: %w", err)
	}
	return nil
}

func (p meetingProcessing) storedTranscript(meetingID string, saved *string) (string, error) {
	if saved != nil && *saved != "" {
		return *saved, nil
	}
	segments, err := p.store.GetSegments(meetingID)
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
	p.report().EnhancementStarted()
	progress := p.report().AIProgress
	if progress != nil {
		progress(ai.Progress{Stage: ai.ProgressRefineNotes, Current: 1, Total: 1})
	}
	extraction, err := ai.DecodeExtractionJSON(*session.meeting.ExtractionJSON)
	if err != nil {
		return p.saveEnhanceFailure(session, transcript, err)
	}
	summary, err := p.enhancer().RefineNotes(ctx, extraction, *session.meeting.Summary, options.refinementGuidance(), enhanceLanguage(session, options))
	if err != nil {
		return p.saveEnhanceFailure(session, transcript, err)
	}
	return p.saveEnhancement(session, extraction, transcript, summary)
}

func (p meetingProcessing) enhanceAndSave(ctx context.Context, session recordingSession, transcript string, options EnhanceOptions) error {
	p.report().EnhancementStarted()
	runOptions := options.runOptions(previousSummary(session, options), p.report().AIProgress, enhanceLanguage(session, options))
	extraction, summary, err := p.enhancer().RunWithOptions(ctx, transcript, runOptions)
	if err != nil {
		return p.saveEnhanceFailure(session, transcript, err)
	}
	return p.saveEnhancement(session, extraction, transcript, summary)
}

func (p meetingProcessing) saveEnhancement(session recordingSession, extraction *ai.Extraction, transcript, summary string) error {
	extractionJSON, err := ai.EncodeExtraction(extraction)
	if err != nil {
		return p.saveEnhanceFailure(session, transcript, err)
	}
	if err := p.completeProcessing(session, extraction.Title, transcript, summary, extractionJSON); err != nil {
		return err
	}
	p.report().EnhancementCompleted(summary, len(extraction.ActionItems), session.meeting.ID)
	return nil
}

func (p meetingProcessing) completeProcessing(session recordingSession, title, transcript, summary, extractionJSON string) error {
	db.LifecycleFor(session.meeting).ProcessingCompleted(title, transcript, summary, extractionJSON, nowUTC())
	if err := p.store.UpdateMeeting(session.meeting); err != nil {
		return fmt.Errorf("update meeting: %w", err)
	}
	return session.emit(EventCompleted, nil)
}

func (p meetingProcessing) saveEnhanceFailure(session recordingSession, transcript string, err error) error {
	db.LifecycleFor(session.meeting).EnhancementFailed(transcript, nowUTC(), err)
	updateErr := p.store.UpdateMeeting(session.meeting)
	if updateErr != nil {
		return errors.Join(fmt.Errorf("enhance failed: %w", err), fmt.Errorf("save transcript: %w", updateErr))
	}
	if emitErr := session.emit(EventFailed, err); emitErr != nil {
		return emitErr
	}
	return fmt.Errorf("enhance failed (transcript saved): %w", err)
}

func (o EnhanceOptions) runOptions(previous string, progress func(ai.Progress), language string) ai.RunOptions {
	return ai.RunOptions{UserNotes: o.Notes, Feedback: o.Feedback, PreviousNotes: previous, RefineNotes: o.Refine, OnProgress: progress, Language: language}
}

func (o EnhanceOptions) refinementGuidance() string {
	return ai.RunOptions{UserNotes: o.Notes, Feedback: o.Feedback}.RefinementGuidance()
}

func enhanceLanguage(session recordingSession, options EnhanceOptions) string {
	if options.Language != "" {
		return meetinglang.Normalize(options.Language)
	}
	return meetinglang.Normalize(session.meeting.Language)
}

func previousSummary(session recordingSession, options EnhanceOptions) string {
	if !wantsRefinement(options) || !filled(session.meeting.Summary) {
		return ""
	}
	return *session.meeting.Summary
}

func (p meetingProcessing) enhancer() enhancer {
	if p.notesEnhancer != nil {
		return p.notesEnhancer
	}
	return p.pipeline
}

func printAIProgress(out io.Writer, progress ai.Progress) {
	if progress.Total > 1 {
		fmt.Fprintf(out, "● AI %s %d/%d\n", progress.Stage, progress.Current, progress.Total)
		return
	}
	fmt.Fprintf(out, "● AI %s\n", progress.Stage)
}

func printEnhancementResult(out io.Writer, summary string, actionItems int, meetingID string) {
	fmt.Fprintln(out, "\n── Notes ───────────────────────────────")
	fmt.Fprintln(out, summary)
	if actionItems > 0 {
		fmt.Fprintf(out, "\n● %d action items extracted.\n", actionItems)
	}
	fmt.Fprintf(out, "● Saved: %s\n", meetingID)
}
