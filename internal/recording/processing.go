package recording

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
)

type ProcessingReporter interface {
	Transcribing(string)
	TranscriptionSkipped(string)
	TranscriptionFailed(string, error)
	SegmentsSaved(int)
	TranscriptSaved(string)
	ProcessingFailure(*string)
	EnhancementStarted()
	AIProgress(ai.Progress)
	EnhancementCompleted(string, int, string)
}

type meetingProcessing struct {
	store         meetingStore
	transcriber   transcriber
	notesEnhancer enhancer
	pipeline      *ai.Pipeline
	reporter      ProcessingReporter
	events        EventSink
}

func (s Service) processing() meetingProcessing {
	return meetingProcessing{
		store: s.meetings(), transcriber: s.transcriber, notesEnhancer: s.enhancer,
		pipeline: s.Pipeline, reporter: s.Reporter, events: s.Events,
	}
}

func (p meetingProcessing) sessionFor(meeting *db.Meeting, artifacts audioartifact.Artifacts) recordingSession {
	return recordingSession{store: p.store, events: p.events, meeting: meeting, artifacts: artifacts}
}

func NewConsoleProcessingReporter(out, errOut io.Writer) ProcessingReporter {
	return consoleProcessingReporter{out: out, errOut: errOut}
}

type consoleProcessingReporter struct{ out, errOut io.Writer }
type noopProcessingReporter struct{}

func (p meetingProcessing) report() ProcessingReporter {
	if p.reporter != nil {
		return p.reporter
	}
	return noopProcessingReporter{}
}

func (p meetingProcessing) beginCaptured(session recordingSession, at string) error {
	lifecycleFor(session.meeting).captured(at)
	if err := p.store.UpdateMeeting(session.meeting); err != nil {
		return fmt.Errorf("mark meeting captured: %w", err)
	}
	return p.emitProcessing(session)
}

func (p meetingProcessing) processClaimedCaptured(ctx context.Context, session recordingSession, language string) error {
	if err := p.emitProcessing(session); err != nil {
		return err
	}
	return p.processCaptured(ctx, session, language)
}

func (p meetingProcessing) emitProcessing(session recordingSession) error {
	return session.emit(EventProcessing, nil)
}

func (r consoleProcessingReporter) Transcribing(speaker string) {
	fmt.Fprintf(r.out, "● Transcribing %s audio with Apple Speech...\n", speaker)
}

func (r consoleProcessingReporter) TranscriptionSkipped(path string) {
	fmt.Fprintf(r.out, "  skipping %s: file missing or empty (no audio captured)\n", filepath.Base(path))
}

func (r consoleProcessingReporter) TranscriptionFailed(speaker string, err error) {
	fmt.Fprintf(r.errOut, "  error: %s transcription failed: %v\n", speaker, err)
}

func (r consoleProcessingReporter) SegmentsSaved(count int) {
	fmt.Fprintf(r.out, "● Got %d segments\n", count)
}

func (r consoleProcessingReporter) TranscriptSaved(transcript string) {
	fmt.Fprintln(r.out, "\n── Transcript ──────────────────────────")
	fmt.Fprintln(r.out, transcript)
}

func (r consoleProcessingReporter) ProcessingFailure(audioPath *string) {
	if audioPath != nil {
		fmt.Fprintf(r.out, "  session saved (audio may be incomplete — check %s)\n", *audioPath)
	}
}

func (r consoleProcessingReporter) EnhancementStarted() {
	fmt.Fprintln(r.out, "── Enhancing with AI... ─────────────────")
}

func (r consoleProcessingReporter) AIProgress(progress ai.Progress) { printAIProgress(r.out, progress) }

func (r consoleProcessingReporter) EnhancementCompleted(summary string, actionItems int, meetingID string) {
	printEnhancementResult(r.out, summary, actionItems, meetingID)
}

func (noopProcessingReporter) Transcribing(string)                      {}
func (noopProcessingReporter) TranscriptionSkipped(string)              {}
func (noopProcessingReporter) TranscriptionFailed(string, error)        {}
func (noopProcessingReporter) SegmentsSaved(int)                        {}
func (noopProcessingReporter) TranscriptSaved(string)                   {}
func (noopProcessingReporter) ProcessingFailure(*string)                {}
func (noopProcessingReporter) EnhancementStarted()                      {}
func (noopProcessingReporter) AIProgress(ai.Progress)                   {}
func (noopProcessingReporter) EnhancementCompleted(string, int, string) {}

func (p meetingProcessing) processAfterCapture(req Request, session recordingSession) error {
	if err := p.beginCaptured(session, nowUTC()); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	err := p.processCaptured(ctx, session, req.Language)
	if err != nil && req.SuppressProcessingFailure {
		return nil
	}
	return err
}
