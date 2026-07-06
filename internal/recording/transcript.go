package recording

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

func (p meetingProcessing) processCaptured(ctx context.Context, session recordingSession, language string) error {
	segments, err := p.transcribeStreams(ctx, session.artifacts, session.meeting.ID, language)
	if err != nil {
		return p.saveProcessingFailure(session, err)
	}
	if len(segments) == 0 {
		return p.saveProcessingFailure(session, fmt.Errorf("no audio to transcribe"))
	}
	transcript, err := p.saveSegments(session, segments)
	if err != nil {
		return err
	}
	return p.enhanceAndSave(ctx, session, transcript, EnhanceOptions{Language: language})
}

func (p meetingProcessing) saveSegments(session recordingSession, segments []db.Segment) (string, error) {
	p.report().SegmentsSaved(len(segments))
	if err := p.store.ReplaceSegments(session.meeting.ID, segments); err != nil {
		return "", fmt.Errorf("save segments: %w", err)
	}
	transcript := FormatTranscript(segments)
	if err := p.saveTranscript(session, transcript); err != nil {
		return "", err
	}
	p.report().TranscriptSaved(transcript)
	return transcript, nil
}

func (p meetingProcessing) saveTranscript(session recordingSession, transcript string) error {
	return p.store.SaveTranscript(session.meeting, transcript, nowUTC())
}

func (p meetingProcessing) saveProcessingFailure(session recordingSession, origErr error) error {
	updateErr := p.store.MarkProcessingFailed(session.meeting, nowUTC(), origErr)
	if updateErr != nil {
		return errors.Join(fmt.Errorf("transcription failed: %w", origErr), fmt.Errorf("save partial meeting: %w", updateErr))
	}
	return p.emitProcessingFailure(session, origErr)
}

func (p meetingProcessing) emitProcessingFailure(session recordingSession, origErr error) error {
	p.report().ProcessingFailure(session.meeting.AudioPath)
	if err := session.emit(EventFailed, origErr); err != nil {
		return err
	}
	return fmt.Errorf("transcription failed: %w", origErr)
}

func (p meetingProcessing) transcribeStreams(ctx context.Context, artifacts audioartifact.Artifacts, meetingID, language string) ([]db.Segment, error) {
	var all []db.Segment
	var errs []string
	for _, src := range artifacts.Sources() {
		segments, err := p.transcribeSource(ctx, src, meetingID, language)
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
	sortSegmentsChronologically(segments)
	return segments, nil
}

func (p meetingProcessing) transcribeSource(ctx context.Context, src audioartifact.Source, meetingID, language string) ([]db.Segment, error) {
	if !src.HasAudio() {
		return p.skipMissingAudio(src)
	}
	segments, err := p.transcribeAs(ctx, src, language)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", src.Speaker, err)
	}
	return toDBSegments(meetingID, cleanTranscriptionArtifacts(segments)), nil
}

var errMissingAudio = errors.New("missing audio")

func (p meetingProcessing) skipMissingAudio(src audioartifact.Source) ([]db.Segment, error) {
	p.report().TranscriptionSkipped(src.Path)
	return nil, errMissingAudio
}

func (p meetingProcessing) transcribeAs(ctx context.Context, src audioartifact.Source, language string) ([]transcribe.Segment, error) {
	p.report().Transcribing(src.Speaker)
	segs, err := transcribe.TranscribeFile(ctx, src.Path, language)
	if p.transcriber != nil {
		segs, err = p.transcriber.Transcribe(ctx, src.Path)
	}
	if err != nil {
		p.report().TranscriptionFailed(src.Speaker, err)
		return nil, err
	}
	for i := range segs {
		segs[i].Speaker = src.Speaker
	}
	return segs, nil
}
