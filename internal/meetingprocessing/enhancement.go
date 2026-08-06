package meetingprocessing

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

func (s Service) EnhanceStored(ctx context.Context, req StoredRequest) error {
	if err := s.validateStored(req); err != nil {
		return err
	}
	meeting, transcript, err := s.loadStoredTranscript(req.MeetingID)
	if err != nil {
		return err
	}
	if err := s.markProcessing(ctx, meeting, req); err != nil {
		return err
	}
	return s.enhanceStored(ctx, meeting, transcript, req)
}

func (s Service) validateStored(req StoredRequest) error {
	if err := s.require(); err != nil {
		return err
	}
	if req.MeetingID == "" {
		return s.processingError("enhance stored", req.MeetingID, PhaseValidation, ErrNoTranscript)
	}
	return nil
}

func (s Service) loadStoredTranscript(id string) (*db.Meeting, string, error) {
	meeting, err := s.Store.GetMeeting(id)
	if err != nil {
		return nil, "", s.processingError("enhance stored", id, PhaseLifecycle, err)
	}
	transcript, err := s.storedTranscript(id, meeting.Transcript)
	return meeting, transcript, err
}

func (s Service) storedTranscript(meetingID string, saved *string) (string, error) {
	if saved != nil && *saved != "" {
		return *saved, nil
	}
	segments, err := s.Store.GetSegments(meetingID)
	if err != nil {
		return "", s.processingError("enhance stored", meetingID, PhasePersist, err)
	}
	if len(segments) == 0 {
		return "", s.processingError("enhance stored", meetingID, PhaseValidation, ErrNoTranscript)
	}
	return db.FormatTranscript(segments), nil
}

func (s Service) enhanceStored(ctx context.Context, meeting *db.Meeting, transcript string, req StoredRequest) error {
	if canRefineStored(meeting.ExtractionJSON, meeting.Summary, req) {
		return s.refineStoredSummary(ctx, meeting, transcript, req)
	}
	return s.enhanceAndSave(ctx, meeting, transcript, req)
}

func canRefineStored(extractionJSON, summary *string, req StoredRequest) bool {
	return wantsRefinement(req) && filled(extractionJSON) && filled(summary)
}

func wantsRefinement(req StoredRequest) bool {
	return req.Refine || strings.TrimSpace(req.Feedback) != ""
}

func filled(value *string) bool { return value != nil && strings.TrimSpace(*value) != "" }

func (s Service) refineStoredSummary(ctx context.Context, meeting *db.Meeting, transcript string, req StoredRequest) error {
	s.report().EnhancementStarted()
	s.report().AIProgress(Progress{Stage: string(ai.ProgressRefineNotes), Current: 1, Total: 1})
	extraction, err := ai.DecodeExtractionJSON(*meeting.ExtractionJSON)
	if err != nil {
		return s.saveEnhanceFailure(ctx, meeting, transcript, err)
	}
	summary, err := s.notes().RefineNotes(ctx, extraction, *meeting.Summary, refinementGuidance(req), enhanceLanguage(meeting, req))
	if err != nil {
		return s.saveEnhanceFailure(ctx, meeting, transcript, err)
	}
	return s.saveEnhancement(ctx, meeting, extraction, transcript, summary)
}

func (s Service) enhanceAndSave(ctx context.Context, meeting *db.Meeting, transcript string, req StoredRequest) error {
	s.report().EnhancementStarted()
	extraction, summary, err := s.notes().RunWithOptions(ctx, transcript, s.runOptions(meeting, req))
	if err != nil {
		return s.saveEnhanceFailure(ctx, meeting, transcript, err)
	}
	return s.saveEnhancement(ctx, meeting, extraction, transcript, summary)
}

func (s Service) runOptions(meeting *db.Meeting, req StoredRequest) ai.RunOptions {
	return ai.RunOptions{UserNotes: req.Notes, Feedback: req.Feedback, PreviousNotes: previousSummary(meeting, req), RefineNotes: req.Refine, OnProgress: bridgeProgress(s.report()), Language: enhanceLanguage(meeting, req)}
}

func refinementGuidance(req StoredRequest) string {
	return ai.RunOptions{UserNotes: req.Notes, Feedback: req.Feedback}.RefinementGuidance()
}

func enhanceLanguage(meeting *db.Meeting, req StoredRequest) string {
	if req.Language != "" {
		return meetinglang.Normalize(req.Language)
	}
	return meetinglang.Normalize(meeting.Language)
}

func previousSummary(meeting *db.Meeting, req StoredRequest) string {
	if !wantsRefinement(req) || !filled(meeting.Summary) {
		return ""
	}
	return *meeting.Summary
}

func (s Service) saveEnhancement(ctx context.Context, meeting *db.Meeting, extraction *ai.Extraction, transcript, summary string) error {
	extractionJSON, err := ai.EncodeExtraction(extraction)
	if err != nil {
		return s.saveEnhanceFailure(ctx, meeting, transcript, err)
	}
	return s.completeProcessing(ctx, meeting, extraction, transcript, summary, extractionJSON)
}

func (s Service) completeProcessing(ctx context.Context, meeting *db.Meeting, extraction *ai.Extraction, transcript, summary, extractionJSON string) error {
	completion := meetinglifecycle.Completion{Title: extraction.Title, Transcript: transcript, Summary: summary, ExtractionJSON: extractionJSON, At: s.now()}
	updated, err := s.transition(ctx, meeting.ID, meetinglifecycle.ProcessingCompleted{Completion: completion})
	if err != nil {
		return s.processingError("complete processing", meeting.ID, PhasePersist, err)
	}
	*meeting = *updated
	return s.complete(meeting, extraction, summary)
}

func (s Service) complete(meeting *db.Meeting, extraction *ai.Extraction, summary string) error {
	if err := s.emit(EventCompleted, meeting, nil); err != nil {
		return s.processingError("emit completed", meeting.ID, PhaseEvent, err)
	}
	s.report().EnhancementCompleted(summary, actionCount(extraction), meeting.ID)
	return nil
}

func (s Service) failureTransition(err error, transcript *string) meetinglifecycle.Transition {
	if category(err) == ErrorTransient {
		return meetinglifecycle.ProcessingRequeued{At: s.now()}
	}
	return meetinglifecycle.ProcessingFailed{At: s.now(), Cause: err, Transcript: transcript}
}

func (s Service) saveEnhanceFailure(ctx context.Context, meeting *db.Meeting, transcript string, err error) error {
	transition := s.failureTransition(err, &transcript)
	updated, updateErr := s.transition(ctx, meeting.ID, transition)
	if updateErr != nil {
		return errors.Join(fmt.Errorf("enhance failed: %w", err), fmt.Errorf("save transcript: %w", updateErr))
	}
	*meeting = *updated
	if emitErr := s.emit(EventFailed, meeting, err); emitErr != nil {
		return emitErr
	}
	return fmt.Errorf("enhance failed (transcript saved): %w", err)
}
