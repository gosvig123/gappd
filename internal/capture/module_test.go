package capture

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/livetranscript"
)

const captureScenarioEnv = "GAPPD_TEST_CAPTURE_SCENARIO"

func TestModuleRunCompletesRequestedStop(t *testing.T) {
	setCaptureHelper(t, "clean")
	ctx, cancel := context.WithCancel(context.Background())
	result, err := New().Run(ctx, Input{Mode: ModeBoth, OutputDir: t.TempDir()}, cancelOnCaptureReady(cancel))
	if err != nil || result.StopWarning != nil {
		t.Fatalf("Run() result=%#v error=%v", result, err)
	}
	if !result.Artifacts.HasMicrophoneAudio() || !result.Artifacts.HasSystemAudio() {
		t.Fatal("Run() did not preserve requested audio")
	}
}

func TestModuleRunFailsWhenHelperExitsBeforeReadiness(t *testing.T) {
	setCaptureHelper(t, "exit-before-ready")
	_, err := New().Run(context.Background(), Input{Mode: ModeBoth, OutputDir: t.TempDir()}, drainTranscriptEvents)
	if err == nil || !strings.Contains(err.Error(), "helper exited before readiness") {
		t.Fatalf("Run() error = %v", err)
	}
}

func TestModuleRunRejectsMismatchedReadiness(t *testing.T) {
	setCaptureHelper(t, "mismatched-ready")
	_, err := New().Run(context.Background(), Input{Mode: ModeBoth, OutputDir: t.TempDir()}, drainTranscriptEvents)
	if err == nil || !strings.Contains(err.Error(), "capture readiness sources") {
		t.Fatalf("Run() error = %v", err)
	}
}

func TestModuleRunRejectsMissingRequestedSource(t *testing.T) {
	setCaptureHelper(t, "missing-mic")
	ctx, cancel := context.WithCancel(context.Background())
	_, err := New().Run(ctx, Input{Mode: ModeBoth, OutputDir: t.TempDir()}, cancelOnCaptureReady(cancel))
	if err == nil || !strings.Contains(err.Error(), "microphone audio was not captured") {
		t.Fatalf("Run() error = %v", err)
	}
}

func TestModuleRunRequiresStopAcknowledgement(t *testing.T) {
	setCaptureHelper(t, "no-stop-ack")
	ctx, cancel := context.WithCancel(context.Background())
	_, err := New().Run(ctx, Input{Mode: ModeBoth, OutputDir: t.TempDir()}, cancelOnCaptureReady(cancel))
	if err == nil || !strings.Contains(err.Error(), "did not acknowledge requested stop") {
		t.Fatalf("Run() error = %v", err)
	}
}

func TestModuleRunKeepsNonCleanRequestedStopAsWarning(t *testing.T) {
	setCaptureHelper(t, "nonclean")
	ctx, cancel := context.WithCancel(context.Background())
	result, err := New().Run(ctx, Input{Mode: ModeBoth, OutputDir: t.TempDir()}, cancelOnCaptureReady(cancel))
	if err != nil || result.StopWarning == nil {
		t.Fatalf("Run() result=%#v error=%v", result, err)
	}
}

func TestModuleRunFailsUnexpectedExitWithPayload(t *testing.T) {
	setCaptureHelper(t, "unexpected")
	_, err := New().Run(context.Background(), Input{Mode: ModeBoth, OutputDir: t.TempDir()}, drainTranscriptEvents)
	if err == nil || !strings.Contains(err.Error(), "capture stopped unexpectedly") {
		t.Fatalf("Run() error = %v", err)
	}
}

func TestModuleRunBoundsStalledConsumerCompletion(t *testing.T) {
	setCaptureHelper(t, "many-events")
	ctx, cancel := context.WithCancel(context.Background())
	started := time.Now()
	result, err := New().Run(ctx, Input{Mode: ModeBoth, OutputDir: t.TempDir()}, func(notice Notice) {
		if notice.Kind == NoticeReady {
			cancel()
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Fatalf("Run() took %s with stalled consumer", elapsed)
	}
	if result.StopWarning == nil || !strings.Contains(result.StopWarning.Error(), "capture events did not close") {
		t.Fatalf("StopWarning = %v", result.StopWarning)
	}
}

func TestModuleRunClosesBufferedEventsWithoutActiveConsumer(t *testing.T) {
	setCaptureHelper(t, "complete-stream")
	ctx, cancel := context.WithCancel(context.Background())
	var events <-chan livetranscript.Event
	_, err := New().Run(ctx, Input{Mode: ModeBoth, OutputDir: t.TempDir()}, func(notice Notice) {
		if notice.Kind == NoticeReady {
			events = notice.TranscriptEvents
			cancel()
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for range events {
		count++
	}
	if count != 5 {
		t.Fatalf("event count = %d, want 5", count)
	}
}

func cancelOnCaptureReady(cancel context.CancelFunc) Observe {
	return func(notice Notice) {
		drainTranscriptEvents(notice)
		if notice.Kind == NoticeReady {
			cancel()
		}
	}
}

func drainTranscriptEvents(notice Notice) {
	if notice.TranscriptEvents != nil {
		go func() {
			for range notice.TranscriptEvents {
			}
		}()
	}
}

func setCaptureHelper(t *testing.T, scenario string) {
	t.Helper()
	helper, err := filepath.Abs(filepath.Join("testdata", "capture-helper.sh"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(captureHelperEnv, helper)
	t.Setenv(captureScenarioEnv, scenario)
}
