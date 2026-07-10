package meetingprocessing

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

var errMissingAudio = errors.New("missing audio")

func (s Service) ProcessCaptured(ctx context.Context, req CapturedRequest) error {
	if err := s.validateCaptured(req); err != nil {
		return err
	}
	meeting, err := s.startCapturedProcessing(ctx, req.MeetingID)
	if err != nil {
		return err
	}
	return s.processCaptured(ctx, meeting, req)
}

func (s Service) validateCaptured(req CapturedRequest) error {
	if err := s.require(); err != nil {
		return err
	}
	if req.MeetingID == "" || req.AudioDir == "" {
		return s.processingError("process captured", req.MeetingID, PhaseValidation, ErrNoAudio)
	}
	return nil
}

func (s Service) startCapturedProcessing(ctx context.Context, meetingID string) (*db.Meeting, error) {
	meeting, err := s.Store.GetMeeting(meetingID)
	if err != nil {
		return nil, s.processingError("process captured", meetingID, PhaseLifecycle, err)
	}
	if meeting.ProcessingStatus != db.ProcessingStatusProcessing {
		meeting, err = s.transition(ctx, meetingID, s.capturedStartTransition(meeting))
		if err != nil {
			return nil, s.processingError("process captured", meetingID, PhaseLifecycle, err)
		}
	}
	return meeting, s.emit(EventProcessing, meeting, nil)
}

func (s Service) capturedStartTransition(meeting *db.Meeting) meetinglifecycle.Transition {
	if meeting.ProcessingStatus == db.ProcessingStatusNotStarted {
		return meetinglifecycle.ProcessingStarted{At: s.now()}
	}
	return meetinglifecycle.ProcessingRestarted{At: s.now(), Reason: meetinglifecycle.ReprocessingRetry}
}

func (s Service) processCaptured(ctx context.Context, meeting *db.Meeting, req CapturedRequest) error {
	segments, err := s.transcribeStreams(ctx, req, meeting.ID)
	if err != nil {
		return s.saveProcessingFailure(ctx, meeting, err)
	}
	transcript, err := s.saveSegments(ctx, meeting, segments)
	if err != nil {
		return err
	}
	return s.enhanceAndSave(ctx, meeting, transcript, StoredRequest{Language: req.Language})
}

func (s Service) transcribeStreams(ctx context.Context, req CapturedRequest, meetingID string) ([]db.Segment, error) {
	artifacts := audioartifact.New(req.AudioDir)
	var all []db.Segment
	var errs []string
	for _, src := range artifacts.Sources() {
		segments, err := s.transcribeSource(ctx, src, meetingID, req.Language)
		if errors.Is(err, errMissingAudio) {
			continue
		}
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		all = append(all, segments...)
	}
	return transcribedSegments(all, errs)
}

func transcribedSegments(segments []db.Segment, errs []string) ([]db.Segment, error) {
	if len(segments) == 0 && len(errs) > 0 {
		return nil, fmt.Errorf("transcription failed: %s", strings.Join(errs, "; "))
	}
	if len(segments) == 0 {
		return nil, ErrNoAudio
	}
	sortSegmentsChronologically(segments)
	return segments, nil
}

func (s Service) transcribeSource(ctx context.Context, src audioartifact.Source, meetingID, language string) ([]db.Segment, error) {
	if !src.HasAudio() {
		return s.skipMissingAudio(src)
	}
	segments, err := s.transcribeAs(ctx, src, language)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", src.Speaker, err)
	}
	return toDBSegments(meetingID, cleanTranscriptionArtifacts(segments)), nil
}

func (s Service) skipMissingAudio(src audioartifact.Source) ([]db.Segment, error) {
	s.report().TranscriptionSkipped(src.Path)
	return nil, errMissingAudio
}

func (s Service) transcribeAs(ctx context.Context, src audioartifact.Source, language string) ([]transcribe.Segment, error) {
	s.report().Transcribing(src.Speaker)
	segs, err := s.transcriber().Transcribe(ctx, src.Path, meetinglang.Normalize(language))
	if err != nil {
		s.report().TranscriptionFailed(src.Speaker, err)
		return nil, err
	}
	return segmentsWithSpeaker(segs, src.Speaker), nil
}

func segmentsWithSpeaker(segs []transcribe.Segment, speaker string) []transcribe.Segment {
	for i := range segs {
		segs[i].Speaker = speaker
	}
	return segs
}

func (s Service) saveSegments(ctx context.Context, meeting *db.Meeting, segments []db.Segment) (string, error) {
	s.report().SegmentsSaved(len(segments))
	if err := s.Store.ReplaceSegments(meeting.ID, segments); err != nil {
		return "", s.processingError("process captured", meeting.ID, PhasePersist, err)
	}
	return s.saveTranscript(ctx, meeting, FormatTranscript(segments))
}

func (s Service) saveTranscript(ctx context.Context, meeting *db.Meeting, transcript string) (string, error) {
	transition := meetinglifecycle.TranscriptSaved{At: s.now(), Transcript: transcript}
	updated, err := s.transition(ctx, meeting.ID, transition)
	if err != nil {
		return "", s.processingError("process captured", meeting.ID, PhasePersist, err)
	}
	*meeting = *updated
	s.report().TranscriptSaved(transcript)
	return transcript, nil
}
