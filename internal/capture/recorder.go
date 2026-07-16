package capture

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/livetranscript"
)

type CaptureMode string

const (
	ModeMic    CaptureMode = "mic"
	ModeSystem CaptureMode = "system"
	ModeBoth   CaptureMode = "both"

	captureHelperEnv       = "GAPPD_CAPTURE_HELPER_PATH"
	captureChunkSecondsEnv = "GAPPD_CAPTURE_CHUNK_SECONDS"
	captureChunkOverlapEnv = "GAPPD_CAPTURE_CHUNK_OVERLAP_SECONDS"
)

type Recorder struct {
	mode             CaptureMode
	outputDir        string
	deviceIdx        int
	cmd              *exec.Cmd
	waitCh           chan error
	stderr           bytes.Buffer
	stdoutBuf        bytes.Buffer
	stdout           io.Writer
	transcriptEvents chan livetranscript.Event
	stopFile         string
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
	launch, err := r.captureLaunch()
	if err != nil {
		return err
	}
	r.prepareCommand(launch)
	if err := r.cmd.Start(); err != nil {
		return fmt.Errorf("start capture: %w", err)
	}
	return r.awaitStartup(ctx, r.waitForExit())
}

func (r *Recorder) captureLaunch() (captureLaunch, error) {
	args := []string{"--mode", string(r.mode), "--output-dir", r.outputDir, "--device", fmt.Sprintf("%d", r.deviceIdx)}
	return findCaptureLaunch(appendChunkArgs(args), r.outputDir)
}

func (r *Recorder) prepareCommand(launch captureLaunch) {
	r.cmd = exec.Command(launch.command, launch.args...)
	r.stdoutBuf.Reset()
	r.transcriptEvents = make(chan livetranscript.Event, 32)
	r.cmd.Stdout = newChunkEventWriter(io.MultiWriter(r.stdout, &r.stdoutBuf), r.transcriptEvents)
	r.stderr.Reset()
	r.cmd.Stderr = &r.stderr
	r.cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func (r *Recorder) waitForExit() chan error {
	exited := make(chan error, 1)
	go func() {
		exited <- r.cmd.Wait()
		close(r.transcriptEvents)
	}()
	return exited
}

func (r *Recorder) awaitStartup(ctx context.Context, exited chan error) error {
	select {
	case err := <-exited:
		return r.startupFailure(err)
	case <-ctx.Done():
		_ = r.stopCaptureProcess(syscall.SIGINT)
		<-exited
		return ctx.Err()
	case <-time.After(500 * time.Millisecond):
		r.waitCh = exited
		return nil
	}
}

func (r *Recorder) startupFailure(err error) error {
	if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 126 {
		if msg := strings.TrimSpace(r.stderr.String()); msg != "" {
			return fmt.Errorf("%s", msg)
		}
		return fmt.Errorf("permission denied — check System Settings → Privacy & Security")
	}
	return captureStartFailure(err, r.stderr.String(), r.stdoutBuf.String())
}

func (r *Recorder) Done() <-chan error {
	return r.waitCh
}

func (r *Recorder) TranscriptEvents() <-chan livetranscript.Event { return r.transcriptEvents }

func (r *Recorder) Stop() error {
	if r.cmd == nil || r.cmd.Process == nil || r.waitCh == nil {
		return nil
	}
	if err, exited := r.exited(); exited {
		return err
	}
	if err := r.stopCaptureProcess(syscall.SIGINT); err != nil && err != syscall.ESRCH {
		return fmt.Errorf("stop capture process: %w", err)
	}
	return r.awaitStop()
}

func (r *Recorder) exited() (error, bool) {
	select {
	case err := <-r.waitCh:
		return err, true
	default:
		return nil, false
	}
}

func (r *Recorder) awaitStop() error {
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
