package capture

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

type CaptureMode string

const (
	ModeMic    CaptureMode = "mic"
	ModeSystem CaptureMode = "system"
	ModeBoth   CaptureMode = "both"
)

type Recorder struct {
	mode      CaptureMode
	outputDir string
	deviceIdx int
	cmd       *exec.Cmd
}

func NewRecorder(mode CaptureMode, outputDir string, deviceIdx int) *Recorder {
	return &Recorder{mode: mode, outputDir: outputDir, deviceIdx: deviceIdx}
}

func (r *Recorder) Start(ctx context.Context) error {
	bin, err := findCaptureBinary()
	if err != nil {
		return err
	}
	args := []string{
		"--mode", string(r.mode),
		"--output-dir", r.outputDir,
		"--device", fmt.Sprintf("%d", r.deviceIdx),
	}
	r.cmd = exec.CommandContext(ctx, bin, args...)
	r.cmd.Stdout = os.Stdout
	r.cmd.Stderr = os.Stderr
	if err := r.cmd.Start(); err != nil {
		return fmt.Errorf("start capture: %w", err)
	}
	return nil
}

func (r *Recorder) Stop() error {
	if r.cmd == nil || r.cmd.Process == nil {
		return nil
	}
	r.cmd.Process.Signal(os.Interrupt)
	return r.cmd.Wait()
}

func (r *Recorder) MicPath() string {
	return filepath.Join(r.outputDir, "mic.wav")
}

func (r *Recorder) SystemPath() string {
	return filepath.Join(r.outputDir, "system.wav")
}

func findCaptureBinary() (string, error) {
	home, _ := os.UserHomeDir()
	paths := []string{
		filepath.Join(home, ".grn", "GrnCapture.app", "Contents", "MacOS", "grn-capture"),
		"./build/GrnCapture.app/Contents/MacOS/grn-capture",
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("grn-capture not found (run: make build-capture)")
}
