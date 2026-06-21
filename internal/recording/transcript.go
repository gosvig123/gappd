package recording

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

func (session recordingSession) postProcess(ctx context.Context, modelPath, defaultModelPath string) error {
	segments, err := session.service.transcribeStreams(ctx, session.artifacts, session.meeting.ID, modelPath, defaultModelPath)
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
	return session.enhanceAndSave(ctx, transcript, "")
}

func (session recordingSession) saveSegments(segments []db.Segment) (string, error) {
	if session.service.Events == nil {
		fmt.Fprintf(session.service.Out, "● Got %d segments\n", len(segments))
	}
	if err := session.service.meetings().ReplaceSegments(session.meeting.ID, segments); err != nil {
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
	if session.service.Events != nil {
		return
	}
	fmt.Fprintln(session.service.Out, "\n── Transcript ──────────────────────────")
	fmt.Fprintln(session.service.Out, transcript)
}

// Enhance re-runs the AI pipeline over a stored meeting's transcript and saves the result.
func (s Service) Enhance(ctx context.Context, meetingID, notes string) error {
	segments, err := s.meetings().GetSegments(meetingID)
	if err != nil {
		return fmt.Errorf("get segments: %w", err)
	}
	if len(segments) == 0 {
		return fmt.Errorf("no segments found for meeting %s", meetingID)
	}
	transcript := FormatTranscript(segments)
	meeting, err := s.meetings().GetMeeting(meetingID)
	if err != nil {
		return fmt.Errorf("get meeting: %w", err)
	}
	session := s.sessionFor(meeting, audioartifact.Artifacts{})
	if err := session.markProcessing(); err != nil {
		return err
	}
	return session.enhanceAndSave(ctx, transcript, notes)
}

func (s Service) transcribeStreams(ctx context.Context, artifacts audioartifact.Artifacts, meetingID, modelPath, defaultModelPath string) ([]db.Segment, error) {
	var all []db.Segment
	var errs []string
	for _, src := range artifacts.Sources() {
		segments, err := s.transcribeSource(ctx, src, meetingID, modelPath, defaultModelPath)
		if errors.Is(err, errMissingAudio) {
			continue
		}
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		all = append(all, segments...)
	}
	if len(all) == 0 && len(errs) > 0 {
		return nil, fmt.Errorf("transcription failed: %s", strings.Join(errs, "; "))
	}
	sortSegmentsChronologically(all)
	return all, nil
}

func (s Service) transcribeSource(ctx context.Context, src audioartifact.Source, meetingID, modelPath, defaultModelPath string) ([]db.Segment, error) {
	segments, err := s.transcribeStream(ctx, src.Path, modelPath, defaultModelPath, src.Speaker)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", src.Speaker, err)
	}
	return toDBSegments(meetingID, segments), nil
}

var errMissingAudio = errors.New("missing audio")

func (s Service) transcribeStream(ctx context.Context, audioPath, modelPath, defaultModelPath, speaker string) ([]transcribe.Segment, error) {
	if !audioartifact.FileHasAudio(audioPath) {
		if s.Events == nil {
			fmt.Fprintf(s.Out, "  skipping %s: file missing or empty (no audio captured)\n", filepath.Base(audioPath))
		}
		return nil, errMissingAudio
	}
	segments, err := s.transcribeAs(ctx, audioPath, modelPath, defaultModelPath, speaker)
	if err != nil {
		fmt.Fprintf(s.ErrOut, "  error: %s transcription failed: %v\n", speaker, err)
		return nil, err
	}
	return segments, nil
}

func (s Service) transcribeAs(ctx context.Context, audioPath, modelPath, defaultModelPath, speaker string) ([]transcribe.Segment, error) {
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		return nil, whisperModelNotFoundError(modelPath, defaultModelPath)
	}
	if s.Events == nil {
		fmt.Fprintf(s.Out, "● Transcribing %s audio...\n", speaker)
	}
	segs, err := transcribe.TranscribeFile(ctx, audioPath, modelPath)
	if s.transcriber != nil {
		segs, err = s.transcriber.Transcribe(ctx, audioPath, modelPath)
	}
	if err != nil {
		return nil, err
	}
	for i := range segs {
		segs[i].Speaker = speaker
	}
	return segs, nil
}

func (session recordingSession) enhanceAndSave(ctx context.Context, transcript, notes string) error {
	if session.service.Events == nil {
		fmt.Fprintln(session.service.Out, "── Enhancing with AI... ─────────────────")
	}
	extraction, summary, err := session.enhancer().Run(ctx, transcript, notes)
	if err != nil {
		return session.saveEnhanceFailure(transcript, err)
	}
	if err := session.saveEnhancement(transcript, summary); err != nil {
		return err
	}
	if session.service.Events == nil {
		printEnhancementResult(session.service, summary, len(extraction.ActionItems), session.meeting.ID)
	}
	return nil
}

func (session recordingSession) enhancer() enhancer {
	if session.service.enhancer != nil {
		return session.service.enhancer
	}
	return session.service.Pipeline
}

func printEnhancementResult(s Service, summary string, actionItems int, meetingID string) {
	fmt.Fprintln(s.Out, "\n── Notes ───────────────────────────────")
	fmt.Fprintln(s.Out, summary)
	if actionItems > 0 {
		fmt.Fprintf(s.Out, "\n● %d action items extracted.\n", actionItems)
	}
	fmt.Fprintf(s.Out, "● Saved: %s\n", meetingID)
}

func whisperModelNotFoundError(modelPath, defaultModelPath string) error {
	if modelPath == defaultModelPath {
		return fmt.Errorf("whisper model not found at %s (run: gappd setup or pass --model)", modelPath)
	}
	return fmt.Errorf("whisper model not found at %s", modelPath)
}
