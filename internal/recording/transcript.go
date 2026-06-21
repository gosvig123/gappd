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

func (s Service) postProcess(ctx context.Context, meeting *db.Meeting, artifacts audioartifact.Artifacts, modelPath, defaultModelPath string) error {
	segments, err := s.transcribeStreams(ctx, artifacts, meeting.ID, modelPath, defaultModelPath)
	if err != nil {
		return s.saveProcessingFailure(meeting, err)
	}
	if len(segments) == 0 {
		return s.saveProcessingFailure(meeting, fmt.Errorf("no audio to transcribe"))
	}
	if s.Events == nil {
		fmt.Fprintf(s.Out, "● Got %d segments\n", len(segments))
	}
	if err := s.meetings().ReplaceSegments(meeting.ID, segments); err != nil {
		return fmt.Errorf("save segments: %w", err)
	}
	transcript := FormatTranscript(segments)
	if err := s.saveTranscript(meeting, transcript); err != nil {
		return err
	}
	if s.Events == nil {
		fmt.Fprintln(s.Out, "\n── Transcript ──────────────────────────")
		fmt.Fprintln(s.Out, transcript)
	}
	return s.enhanceAndSave(ctx, meeting, transcript, "")
}

func (s Service) saveTranscript(meeting *db.Meeting, transcript string) error {
	meeting.Transcript = &transcript
	setProcessingStatus(meeting, db.ProcessingStatusProcessing, nowUTC(), nil)
	if err := s.meetings().UpdateMeeting(meeting); err != nil {
		return fmt.Errorf("save transcript: %w", err)
	}
	return s.emit(EventProcessing, *meeting, nil)
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
	setProcessingStatus(meeting, db.ProcessingStatusProcessing, nowUTC(), nil)
	if err := s.meetings().UpdateMeeting(meeting); err != nil {
		return fmt.Errorf("mark meeting processing: %w", err)
	}
	return s.enhanceAndSave(ctx, meeting, transcript, notes)
}

func (s Service) transcribeStreams(ctx context.Context, artifacts audioartifact.Artifacts, meetingID, modelPath, defaultModelPath string) ([]db.Segment, error) {
	var all []db.Segment
	var errs []string
	for _, src := range artifacts.Sources() {
		segments, err := s.transcribeStream(ctx, src.Path, modelPath, defaultModelPath, src.Speaker)
		if errors.Is(err, errMissingAudio) {
			continue
		}
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", src.Speaker, err))
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

func (s Service) enhanceAndSave(ctx context.Context, meeting *db.Meeting, transcript, notes string) error {
	if s.Events == nil {
		fmt.Fprintln(s.Out, "── Enhancing with AI... ─────────────────")
	}
	var runner enhancer = s.Pipeline
	if s.enhancer != nil {
		runner = s.enhancer
	}
	extraction, summary, err := runner.Run(ctx, transcript, notes)
	if err != nil {
		return s.saveEnhanceFailure(meeting, transcript, err)
	}
	meeting.Transcript = &transcript
	meeting.Summary = &summary
	setProcessingStatus(meeting, db.ProcessingStatusCompleted, nowUTC(), nil)
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
	setProcessingStatus(meeting, db.ProcessingStatusFailed, nowUTC(), err)
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
