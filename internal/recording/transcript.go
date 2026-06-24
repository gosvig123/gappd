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

type meetingProcessing struct {
	service Service
}

func (s Service) processing() meetingProcessing {
	return meetingProcessing{service: s}
}

func (p meetingProcessing) processCaptured(ctx context.Context, session recordingSession, modelPath, defaultModelPath string) error {
	segments, err := p.transcribeStreams(ctx, session.artifacts, session.meeting.ID, modelPath, defaultModelPath)
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
	return p.enhanceAndSave(ctx, session, transcript, "")
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
	return s.processing().enhanceStored(ctx, meetingID, notes)
}

func (p meetingProcessing) enhanceStored(ctx context.Context, meetingID, notes string) error {
	segments, err := p.service.meetings().GetSegments(meetingID)
	if err != nil {
		return fmt.Errorf("get segments: %w", err)
	}
	if len(segments) == 0 {
		return fmt.Errorf("no segments found for meeting %s", meetingID)
	}
	transcript := FormatTranscript(segments)
	meeting, err := p.service.meetings().GetMeeting(meetingID)
	if err != nil {
		return fmt.Errorf("get meeting: %w", err)
	}
	session := p.service.sessionFor(meeting, audioartifact.Artifacts{})
	if err := session.markProcessing(); err != nil {
		return err
	}
	return p.enhanceAndSave(ctx, session, transcript, notes)
}

func (p meetingProcessing) transcribeStreams(ctx context.Context, artifacts audioartifact.Artifacts, meetingID, modelPath, defaultModelPath string) ([]db.Segment, error) {
	var all []db.Segment
	var errs []string
	for _, src := range artifacts.Sources() {
		segments, err := p.transcribeSource(ctx, src, meetingID, modelPath, defaultModelPath)
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

func (p meetingProcessing) transcribeSource(ctx context.Context, src audioartifact.Source, meetingID, modelPath, defaultModelPath string) ([]db.Segment, error) {
	segments, err := p.transcribeStream(ctx, src.Path, modelPath, defaultModelPath, src.Speaker)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", src.Speaker, err)
	}
	return toDBSegments(meetingID, segments), nil
}

var errMissingAudio = errors.New("missing audio")

func (p meetingProcessing) transcribeStream(ctx context.Context, audioPath, modelPath, defaultModelPath, speaker string) ([]transcribe.Segment, error) {
	if !audioartifact.FileHasAudio(audioPath) {
		if p.service.Events == nil {
			fmt.Fprintf(p.service.Out, "  skipping %s: file missing or empty (no audio captured)\n", filepath.Base(audioPath))
		}
		return nil, errMissingAudio
	}
	segments, err := p.transcribeAs(ctx, audioPath, modelPath, defaultModelPath, speaker)
	if err != nil {
		fmt.Fprintf(p.service.ErrOut, "  error: %s transcription failed: %v\n", speaker, err)
		return nil, err
	}
	return segments, nil
}

func (p meetingProcessing) transcribeAs(ctx context.Context, audioPath, modelPath, defaultModelPath, speaker string) ([]transcribe.Segment, error) {
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		return nil, whisperModelNotFoundError(modelPath, defaultModelPath)
	}
	if p.service.Events == nil {
		fmt.Fprintf(p.service.Out, "● Transcribing %s audio...\n", speaker)
	}
	segs, err := transcribe.TranscribeFile(ctx, audioPath, modelPath)
	if p.service.transcriber != nil {
		segs, err = p.service.transcriber.Transcribe(ctx, audioPath, modelPath)
	}
	if err != nil {
		return nil, err
	}
	for i := range segs {
		segs[i].Speaker = speaker
	}
	return segs, nil
}

func (p meetingProcessing) enhanceAndSave(ctx context.Context, session recordingSession, transcript, notes string) error {
	if p.service.Events == nil {
		fmt.Fprintln(p.service.Out, "── Enhancing with AI... ─────────────────")
	}
	extraction, summary, err := p.enhancer().Run(ctx, transcript, notes)
	if err != nil {
		return session.saveEnhanceFailure(transcript, err)
	}
	if err := session.saveEnhancement(extraction.Title, transcript, summary); err != nil {
		return err
	}
	if p.service.Events == nil {
		printEnhancementResult(p.service, summary, len(extraction.ActionItems), session.meeting.ID)
	}
	return nil
}

func (p meetingProcessing) enhancer() enhancer {
	if p.service.enhancer != nil {
		return p.service.enhancer
	}
	return p.service.Pipeline
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
