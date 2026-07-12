package meetingprocessing

import (
	"fmt"
	"io"
	"path/filepath"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/db"
)

type EventName string

const (
	EventProcessing EventName = "processing.started"
	EventCompleted  EventName = "processing.completed"
	EventFailed     EventName = "processing.failed"
)

type Event struct {
	Name    EventName
	Meeting db.Meeting
	Err     error
}

type EventSink interface{ EmitProcessingEvent(Event) error }

type ProcessingStage string

const (
	StageLiveDrain         ProcessingStage = "transcript.live_drain"
	processingTimingPrefix                 = "● Timing "
)

type Reporter interface {
	Transcribing(string)
	TranscriptionSkipped(string)
	TranscriptionFailed(string, error)
	EnhancementStarted()
	AIProgress(Progress)
	EnhancementCompleted(string, int, string)
	StageCompleted(ProcessingStage, time.Duration)
}

type Progress struct {
	Stage   string
	Current int
	Total   int
}

type consoleReporter struct{ out, errOut io.Writer }
type noopReporter struct{ timing io.Writer }

func NewConsoleReporter(out, errOut io.Writer) Reporter {
	return consoleReporter{out: out, errOut: errOut}
}

func NewTimingReporter(out io.Writer) Reporter { return noopReporter{timing: out} }

func (r consoleReporter) Transcribing(speaker string) {
	fmt.Fprintf(r.out, "● Transcribing %s audio with Apple Speech...\n", speaker)
}

func (r consoleReporter) TranscriptionSkipped(path string) {
	fmt.Fprintf(r.out, "  skipping %s: file missing or empty (no audio captured)\n", filepath.Base(path))
}

func (r consoleReporter) TranscriptionFailed(speaker string, err error) {
	fmt.Fprintf(r.errOut, "  error: %s transcription failed: %v\n", speaker, err)
}

func (r consoleReporter) EnhancementStarted() {
	fmt.Fprintln(r.out, "── Enhancing with AI... ─────────────────")
}

func (r consoleReporter) AIProgress(progress Progress) { printAIProgress(r.out, progress) }

func (r consoleReporter) EnhancementCompleted(summary string, actionItems int, meetingID string) {
	printEnhancementResult(r.out, summary, actionItems, meetingID)
}

func (r consoleReporter) StageCompleted(stage ProcessingStage, duration time.Duration) {
	printStageDuration(r.out, stage, duration)
}

func (noopReporter) Transcribing(string)                      {}
func (noopReporter) TranscriptionSkipped(string)              {}
func (noopReporter) TranscriptionFailed(string, error)        {}
func (noopReporter) EnhancementStarted()                      {}
func (noopReporter) AIProgress(Progress)                      {}
func (noopReporter) EnhancementCompleted(string, int, string) {}
func (r noopReporter) StageCompleted(stage ProcessingStage, duration time.Duration) {
	if r.timing != nil {
		printStageDuration(r.timing, stage, duration)
	}
}

func bridgeProgress(report Reporter) func(ai.Progress) {
	return func(progress ai.Progress) {
		report.AIProgress(Progress{Stage: string(progress.Stage), Current: progress.Current, Total: progress.Total})
	}
}

func printStageDuration(out io.Writer, stage ProcessingStage, duration time.Duration) {
	fmt.Fprintf(out, "%s%s: %s\n", processingTimingPrefix, stage, duration.Round(time.Millisecond))
}

func printAIProgress(out io.Writer, progress Progress) {
	if progress.Total > 1 {
		fmt.Fprintf(out, "● AI %s %d/%d\n", progress.Stage, progress.Current, progress.Total)
		return
	}
	fmt.Fprintf(out, "● AI %s\n", progress.Stage)
}

func printEnhancementResult(out io.Writer, summary string, actionItems int, meetingID string) {
	fmt.Fprintln(out, "\n── Notes ───────────────────────────────")
	fmt.Fprintln(out, summary)
	if actionItems > 0 {
		fmt.Fprintf(out, "\n● %d action items extracted.\n", actionItems)
	}
	fmt.Fprintf(out, "● Saved: %s\n", meetingID)
}
