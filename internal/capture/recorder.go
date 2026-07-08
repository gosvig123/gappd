package capture

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/audioartifact"
)

type CaptureMode string

const (
	ModeMic    CaptureMode = "mic"
	ModeSystem CaptureMode = "system"
	ModeBoth   CaptureMode = "both"

	captureHelperEnv       = "GAPPD_CAPTURE_HELPER_PATH"
	captureChunkSecondsEnv = "GAPPD_CAPTURE_CHUNK_SECONDS"
)

type captureLaunch struct {
	command string
	args    []string
}

type Recorder struct {
	mode      CaptureMode
	outputDir string
	deviceIdx int
	cmd       *exec.Cmd
	waitCh    chan error
	stderr    bytes.Buffer
	stdoutBuf bytes.Buffer
	stdout    io.Writer
	chunks    chan ChunkEvent
	stopFile  string
}

func NewRecorder(mode CaptureMode, outputDir string, deviceIdx int) *Recorder {
	return NewRecorderWithOutput(mode, outputDir, deviceIdx, os.Stdout)
}

func NewRecorderWithOutput(mode CaptureMode, outputDir string, deviceIdx int, stdout io.Writer) *Recorder {
	return &Recorder{mode: mode, outputDir: outputDir, deviceIdx: deviceIdx, stdout: stdout}
}

func (r *Recorder) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	args := []string{
		"--mode", string(r.mode),
		"--output-dir", r.outputDir,
		"--device", fmt.Sprintf("%d", r.deviceIdx),
	}
	args = appendChunkArgs(args)
	launch, err := findCaptureLaunch(args, r.outputDir)
	if err != nil {
		return err
	}
	r.cmd = exec.Command(launch.command, launch.args...)
	r.stdoutBuf.Reset()
	r.chunks = make(chan ChunkEvent, 32)
	r.cmd.Stdout = newChunkEventWriter(io.MultiWriter(r.stdout, &r.stdoutBuf), r.chunks)
	r.stderr.Reset()
	r.cmd.Stderr = &r.stderr
	r.cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := r.cmd.Start(); err != nil {
		return fmt.Errorf("start capture: %w", err)
	}
	errCh := make(chan error, 1)
	go func() {
		errCh <- r.cmd.Wait()
		close(r.chunks)
	}()
	select {
	case err := <-errCh:
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 126 {
			if msg := strings.TrimSpace(r.stderr.String()); msg != "" {
				return fmt.Errorf("%s", msg)
			}
			return fmt.Errorf("permission denied — check System Settings → Privacy & Security")
		}
		return captureStartFailure(err, r.stderr.String(), r.stdoutBuf.String())
	case <-ctx.Done():
		_ = r.stopCaptureProcess(syscall.SIGINT)
		<-errCh
		return ctx.Err()
	case <-time.After(500 * time.Millisecond):
		r.waitCh = errCh
	}
	return nil
}

func (r *Recorder) Done() <-chan error {
	return r.waitCh
}

func (r *Recorder) Chunks() <-chan ChunkEvent {
	return r.chunks
}

func (r *Recorder) Stop() error {
	if r.cmd == nil || r.cmd.Process == nil || r.waitCh == nil {
		return nil
	}
	select {
	case err := <-r.waitCh:
		return err
	default:
	}
	if err := r.stopCaptureProcess(syscall.SIGINT); err != nil && err != syscall.ESRCH {
		return fmt.Errorf("stop capture process: %w", err)
	}
	select {
	case err := <-r.waitCh:
		return err
	case <-time.After(5 * time.Second):
		_ = r.killProcessGroup(syscall.SIGKILL)
		<-r.waitCh
		return fmt.Errorf("capture process did not exit cleanly")
	}
}

func (r *Recorder) stopCaptureProcess(sig syscall.Signal) error {
	return r.killProcessGroup(sig)
}

func (r *Recorder) killProcessGroup(sig syscall.Signal) error {
	return syscall.Kill(-r.cmd.Process.Pid, sig)
}

func (r *Recorder) Artifacts() audioartifact.Artifacts {
	return audioartifact.New(r.outputDir)
}

func appendChunkArgs(args []string) []string {
	seconds := strings.TrimSpace(os.Getenv(captureChunkSecondsEnv))
	if seconds == "" {
		return args
	}
	return append(args, "--chunk-seconds", seconds)
}

func findCaptureLaunch(args []string, _ string) (captureLaunch, error) {
	bin, err := findCaptureBinary()
	if err != nil {
		return captureLaunch{}, err
	}
	return captureLaunch{command: bin, args: args}, nil
}

func captureStartFailure(err error, stderr string, stdout string) error {
	msg := startupOutput(stderr, stdout)
	if err == nil && msg != "" {
		return fmt.Errorf("capture process exited immediately: %s", msg)
	}
	if err == nil {
		return fmt.Errorf("capture process exited immediately")
	}
	if msg != "" {
		return fmt.Errorf("capture process failed to start: %w: %s", err, msg)
	}
	return fmt.Errorf("capture process failed to start: %w", err)
}

func startupOutput(stderr string, stdout string) string {
	parts := []string{}
	if msg := strings.TrimSpace(stderr); msg != "" {
		parts = append(parts, msg)
	}
	if msg := strings.TrimSpace(stdout); msg != "" {
		parts = append(parts, msg)
	}
	return strings.Join(parts, "\n")
}

func findCaptureBinary() (string, error) {
	if override := strings.TrimSpace(os.Getenv(captureHelperEnv)); override != "" {
		if found, ok := existingPath(override); ok {
			return found, nil
		}
		return "", fmt.Errorf("capture helper override not found: %s", override)
	}
	for _, path := range captureBinaryCandidates() {
		if found, ok := existingPath(path); ok {
			return found, nil
		}
	}
	return "", fmt.Errorf("gappd-capture not found (set GAPPD_CAPTURE_HELPER_PATH or run: make build-capture)")
}

func existingPath(path string) (string, bool) {
	cleaned := strings.TrimSpace(path)
	if cleaned == "" {
		return "", false
	}
	_, err := os.Stat(cleaned)
	return cleaned, err == nil
}

func captureBinaryCandidates() []string {
	home, _ := os.UserHomeDir()
	return append(bundleCaptureCandidates(), filepath.Join(home, ".gappd", "GappdCapture.app", "Contents", "MacOS", "gappd-capture"), "./build/GappdCapture.app/Contents/MacOS/gappd-capture")
}

func bundleCaptureCandidates() []string {
	exePath, err := os.Executable()
	if err != nil {
		return nil
	}
	if resolvedPath, err := filepath.EvalSymlinks(exePath); err == nil {
		exePath = resolvedPath
	}
	exeDir := filepath.Dir(exePath)
	return []string{
		filepath.Join(exeDir, "GappdCapture.app", "Contents", "MacOS", "gappd-capture"),
		filepath.Join(exeDir, "..", "GappdCapture.app", "Contents", "MacOS", "gappd-capture"),
		filepath.Join(exeDir, "..", "Resources", "GappdCapture.app", "Contents", "MacOS", "gappd-capture"),
	}
}
