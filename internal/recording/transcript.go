package recording

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

func (p meetingProcessing) processCaptured(ctx context.Context, session recordingSession) error {
	segments, err := p.transcribeStreams(ctx, session.artifacts, session.meeting.ID)
	if err != nil {
		return session.saveProcessingFailure(err)
	}
	if len(segments) == 0 {
		return session.saveProcessingFailure(fmt.Errorf("no audio to transcribe"))
	}
	transcript, err := session.saveSegments(segments)
	if err != nil {
		return err
	}
	return p.enhanceAndSave(ctx, session, transcript, EnhanceOptions{})
}

func (session recordingSession) saveSegments(segments []db.Segment) (string, error) {
	if session.events == nil {
		fmt.Fprintf(session.out, "● Got %d segments\n", len(segments))
	}
	if err := session.store.ReplaceSegments(session.meeting.ID, segments); err != nil {
		return "", fmt.Errorf("save segments: %w", err)
	}
	transcript := FormatTranscript(segments)
	if err := session.saveTranscript(transcript); err != nil {
		return "", err
	}
	session.printTranscript(transcript)
	return transcript, nil
}

func (session recordingSession) printTranscript(transcript string) {
	if session.events != nil {
		return
	}
	fmt.Fprintln(session.out, "\n── Transcript ──────────────────────────")
	fmt.Fprintln(session.out, transcript)
}

func (p meetingProcessing) transcribeStreams(ctx context.Context, artifacts audioartifact.Artifacts, meetingID string) ([]db.Segment, error) {
	var all []db.Segment
	var errs []string
	for _, src := range artifacts.Sources() {
		segments, err := p.transcribeSource(ctx, src, meetingID)
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

func (p meetingProcessing) transcribeSource(ctx context.Context, src audioartifact.Source, meetingID string) ([]db.Segment, error) {
	segments, err := p.transcribeStream(ctx, src.Path, src.Speaker)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", src.Speaker, err)
	}
	return toDBSegments(meetingID, cleanTranscriptionArtifacts(segments)), nil
}

var errMissingAudio = errors.New("missing audio")

func (p meetingProcessing) transcribeStream(ctx context.Context, audioPath, speaker string) ([]transcribe.Segment, error) {
	if !audioartifact.FileHasAudio(audioPath) {
		return p.skipMissingAudio(audioPath)
	}
	segments, err := p.transcribeAs(ctx, audioPath, speaker)
	if err != nil {
		fmt.Fprintf(p.errOut, "  error: %s transcription failed: %v\n", speaker, err)
		return nil, err
	}
	return segments, nil
}

func (p meetingProcessing) skipMissingAudio(audioPath string) ([]transcribe.Segment, error) {
	if p.events == nil {
		fmt.Fprintf(p.out, "  skipping %s: file missing or empty (no audio captured)\n", filepath.Base(audioPath))
	}
	return nil, errMissingAudio
}

func (p meetingProcessing) transcribeAs(ctx context.Context, audioPath, speaker string) ([]transcribe.Segment, error) {
	if p.events == nil {
		fmt.Fprintf(p.out, "● Transcribing %s audio with Apple Speech...\n", speaker)
	}
	segs, err := transcribe.TranscribeFile(ctx, audioPath)
	if p.transcriber != nil {
		segs, err = p.transcriber.Transcribe(ctx, audioPath)
	}
	if err != nil {
		return nil, err
	}
	for i := range segs {
		segs[i].Speaker = speaker
	}
	return segs, nil
}
