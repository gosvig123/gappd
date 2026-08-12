package meetingprocessing

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

var errMissingAudio = errors.New("missing audio")

func (s Service) transcribeStreams(ctx context.Context, audioDir, language, meetingID string) ([]db.Segment, error) {
	artifacts := audioartifact.New(audioDir)
	var all []db.Segment
	var errs []string
	for _, src := range artifacts.Sources() {
		segments, err := s.transcribeSource(ctx, src, meetingID, language)
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
	reason := db.SpeakerAssignmentReasonPendingSystemAttribution
	if src.Kind == db.SegmentSourceMicrophone {
		reason = db.SpeakerAssignmentReasonMicrophone
	}
	return toDBSegments(meetingID, transcribe.CleanArtifacts(segments), src.Kind, reason), nil
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
