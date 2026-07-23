package capture

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRecorderStartWaitsForCaptureReadiness(t *testing.T) {
	helper := filepath.Join(t.TempDir(), "capture-helper")
	script := "#!/bin/sh\ntrap 'exit 0' INT TERM\nsleep 0.2\necho '● " + captureReadyOutput + "'\nwhile :; do sleep 1; done\n"
	if err := os.WriteFile(helper, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv(captureHelperEnv, helper)
	recorder := NewRecorderWithOutput(ModeBoth, t.TempDir(), 0, io.Discard)
	started := time.Now()
	if err := recorder.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed < 150*time.Millisecond {
		t.Fatalf("Start returned before readiness after %s", elapsed)
	}
	if err := recorder.Stop(); err != nil {
		t.Fatal(err)
	}
}
