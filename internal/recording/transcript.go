package recording

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

func (s Service) postProcess(ctx context.Context, meeting *db.Meeting, recorder audioRecorder, modelPath, defaultModelPath string) error {
	segments, err := s.transcribeStreams(ctx, recorder, meeting.ID, modelPath, defaultModelPath)
	if err != nil {
		return s.saveProcessingFailure(meeting, err)
	}
	if len(segments) == 0 {
		return s.saveProcessingFailure(meeting, fmt.Errorf("no audio to transcribe"))
	}
	if s.Events == nil {
		fmt.Fprintf(s.Out, "● Got %d segments\n", len(segments))
	}
	if err := s.meetings().InsertSegments(segments); err != nil {
		return fmt.Errorf("save segments: %w", err)
	}
	transcript := formatTranscript(segments)
	if s.Events == nil {
		fmt.Fprintln(s.Out, "\n── Transcript ──────────────────────────")
		fmt.Fprintln(s.Out, transcript)
	}
	return s.enhanceAndSave(meeting, transcript)
}

func (s Service) transcribeStreams(ctx context.Context, recorder audioRecorder, meetingID, modelPath, defaultModelPath string) ([]db.Segment, error) {
	var all []db.Segment
	var errs []string
	for _, src := range []struct{ path, speaker string }{{recorder.MicPath(), "You"}, {recorder.SystemPath(), "Other"}} {
		segments, err := s.transcribeStream(ctx, src.path, modelPath, defaultModelPath, src.speaker)
		if errors.Is(err, errMissingAudio) {
			continue
		}
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", src.speaker, err))
			continue
		}
		all = append(all, toDBSegments(meetingID, segments)...)
	}
	if len(all) == 0 && len(errs) > 0 {
		return nil, fmt.Errorf("transcription failed: %s", strings.Join(errs, "; "))
	}
	sortSegmentsChronologically(all)
	return all, nil
}

var errMissingAudio = errors.New("missing audio")

func (s Service) transcribeStream(ctx context.Context, audioPath, modelPath, defaultModelPath, speaker string) ([]transcribe.Segment, error) {
	if !fileExists(audioPath) {
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

func (s Service) enhanceAndSave(meeting *db.Meeting, transcript string) error {
	if s.Events == nil {
		fmt.Fprintln(s.Out, "── Enhancing with AI... ─────────────────")
	}
	var runner enhancer = s.Pipeline
	if s.enhancer != nil {
		runner = s.enhancer
	}
	extraction, summary, err := runner.Run(context.Background(), transcript, "")
	if err != nil {
		return s.saveEnhanceFailure(meeting, transcript, err)
	}
	meeting.Transcript = &transcript
	meeting.Summary = &summary
	now := time.Now().UTC().Format(time.RFC3339)
	setProcessingStatus(meeting, db.ProcessingStatusCompleted, now, nil)
	if err := s.meetings().UpdateMeeting(meeting); err != nil {
		return fmt.Errorf("update meeting: %w", err)
	}
	if err := s.emit(EventCompleted, *meeting, nil); err != nil {
		return err
	}
	if s.Events == nil {
		printEnhancementResult(s, summary, len(extraction.ActionItems), meeting.ID)
	}
	return nil
}

func printEnhancementResult(s Service, summary string, actionItems int, meetingID string) {
	fmt.Fprintln(s.Out, "\n── Notes ───────────────────────────────")
	fmt.Fprintln(s.Out, summary)
	if actionItems > 0 {
		fmt.Fprintf(s.Out, "\n● %d action items extracted.\n", actionItems)
	}
	fmt.Fprintf(s.Out, "● Saved: %s\n", meetingID)
}

func (s Service) saveEnhanceFailure(meeting *db.Meeting, transcript string, err error) error {
	meeting.Transcript = &transcript
	now := time.Now().UTC().Format(time.RFC3339)
	setProcessingStatus(meeting, db.ProcessingStatusFailed, now, err)
	updateErr := s.meetings().UpdateMeeting(meeting)
	if updateErr != nil {
		return errors.Join(fmt.Errorf("enhance failed: %w", err), fmt.Errorf("save transcript: %w", updateErr))
	}
	if emitErr := s.emit(EventFailed, *meeting, err); emitErr != nil {
		return emitErr
	}
	return fmt.Errorf("enhance failed (transcript saved): %w", err)
}

func whisperModelNotFoundError(modelPath, defaultModelPath string) error {
	if modelPath == defaultModelPath {
		return fmt.Errorf("whisper model not found at %s (run: gappd setup or pass --model)", modelPath)
	}
	return fmt.Errorf("whisper model not found at %s", modelPath)
}
