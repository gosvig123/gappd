package capture

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/processgroup"
)

type captureProcess struct {
	cmd              *exec.Cmd
	stdout           *os.File
	wait             <-chan error
	drain            <-chan error
	ready            <-chan readySignal
	stopAcknowledged <-chan struct{}
	events           *eventRelay
	stderr           *diagnosticTail
	stdoutTail       *diagnosticTail
	waited           bool
	waitErr          error
	drained          bool
	drainErr         error
	eventsDone       bool
}

func (m Module) start(input Input) (*captureProcess, error) {
	args := []string{"--mode", string(input.Mode), "--output-dir", input.OutputDir, "--device", fmt.Sprintf("%d", input.DeviceIndex)}
	launch, err := findCaptureLaunch(appendChunkArgs(args), input.OutputDir)
	if err != nil {
		return nil, err
	}
	stdoutReader, stdoutWriter, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("create capture output pipe: %w", err)
	}
	cmd := exec.Command(launch.command, launch.args...)
	stderr := newDiagnosticTail(8 << 10)
	cmd.Stdout = stdoutWriter
	cmd.Stderr = stderr
	processgroup.Configure(cmd)
	if err := cmd.Start(); err != nil {
		stdoutReader.Close()
		stdoutWriter.Close()
		return nil, fmt.Errorf("start capture: %w", err)
	}
	stdoutWriter.Close()

	events := newEventRelay()
	ready := make(chan readySignal, 1)
	stopAcknowledged := make(chan struct{}, 1)
	tail := newDiagnosticTail(8 << 10)
	drain := make(chan error, 1)
	go func() {
		drain <- drainCaptureOutput(stdoutReader, tail, ready, stopAcknowledged, events.input)
	}()
	wait := make(chan error, 1)
	go func() { wait <- cmd.Wait() }()
	return &captureProcess{cmd: cmd, stdout: stdoutReader, wait: wait, drain: drain, ready: ready,
		stopAcknowledged: stopAcknowledged, events: events, stderr: stderr, stdoutTail: tail}, nil
}

func (p *captureProcess) awaitReady(ctx context.Context, mode CaptureMode) error {
	timer := time.NewTimer(captureStartupTimeout)
	defer timer.Stop()
	select {
	case ready := <-p.ready:
		if err := p.acceptReady(mode, ready); err != nil {
			return errors.Join(err, p.stopBeforeReady())
		}
		return nil
	case waitErr := <-p.wait:
		p.recordWait(waitErr)
		drainErr := p.awaitDrain()
		select {
		case ready := <-p.ready:
			if err := p.acceptReady(mode, ready); err == nil {
				return nil
			} else {
				return errors.Join(err, p.startupFailure(waitErr), drainErr, p.finish(true))
			}
		default:
		}
		return errors.Join(p.startupFailure(waitErr), drainErr, p.finish(true))
	case <-ctx.Done():
		return errors.Join(ctx.Err(), p.stopBeforeReady())
	case <-timer.C:
		timeoutErr := fmt.Errorf("capture process did not become ready within %s", captureStartupTimeout)
		return errors.Join(timeoutErr, p.stopBeforeReady())
	}
}

func (p *captureProcess) acceptReady(mode CaptureMode, ready readySignal) error {
	if ready.err != nil {
		return ready.err
	}
	return validateReadySources(mode, ready.sources)
}

func (p *captureProcess) stopBeforeReady() error {
	_, stopWarning, _ := p.stopAndWait(captureStartupStopTimeout)
	return errors.Join(stopWarning, p.finish(true))
}

func (p *captureProcess) requestStop() (error, error, bool) {
	select {
	case <-p.stopAcknowledged:
	default:
	}
	return p.stopAndWait(captureStopTimeout)
}

func (p *captureProcess) stopWasAcknowledged() bool {
	select {
	case <-p.stopAcknowledged:
		return true
	default:
		return false
	}
}

func (p *captureProcess) stopAndWait(timeout time.Duration) (error, error, bool) {
	if p.waited {
		return p.waitErr, nil, false
	}
	signalErr := processgroup.Signal(p.cmd, syscall.SIGINT)
	delivered := signalErr == nil
	if errors.Is(signalErr, syscall.ESRCH) {
		signalErr = nil
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case waitErr := <-p.wait:
		p.recordWait(waitErr)
		return waitErr, signalErr, delivered
	case <-timer.C:
		killErr := processgroup.Signal(p.cmd, syscall.SIGKILL)
		if errors.Is(killErr, syscall.ESRCH) {
			killErr = nil
		}
		if killErr != nil && p.cmd.Process != nil {
			killErr = errors.Join(killErr, p.cmd.Process.Kill())
		}
		waitErr, waitTimeoutErr := p.waitAfterKill()
		if waitTimeoutErr != nil {
			delivered = false
		}
		warning := errors.Join(signalErr, killErr, waitTimeoutErr,
			fmt.Errorf("capture process did not exit cleanly within %s", timeout))
		return waitErr, warning, delivered
	}
}

func (p *captureProcess) waitAfterKill() (error, error) {
	timer := time.NewTimer(captureStartupStopTimeout)
	defer timer.Stop()
	select {
	case waitErr := <-p.wait:
		p.recordWait(waitErr)
		return waitErr, nil
	case <-timer.C:
		return nil, fmt.Errorf("capture process did not exit after forced stop within %s", captureStartupStopTimeout)
	}
}

func (p *captureProcess) recordWait(waitErr error) {
	p.waited = true
	p.waitErr = waitErr
}

func (p *captureProcess) finishUnexpected(waitErr error) error {
	_ = processgroup.Signal(p.cmd, syscall.SIGKILL)
	return p.unexpectedError(waitErr, p.finish(false))
}

func (p *captureProcess) unexpectedError(waitErr, finishErr error) error {
	unexpected := fmt.Errorf("capture stopped unexpectedly")
	if exitErr := p.exitError(waitErr); exitErr != nil {
		unexpected = fmt.Errorf("capture stopped unexpectedly: %w", exitErr)
	} else if detail := strings.TrimSpace(p.stderr.String()); detail != "" {
		unexpected = fmt.Errorf("capture stopped unexpectedly: %s", detail)
	}
	return errors.Join(unexpected, finishErr)
}

func (p *captureProcess) exitError(waitErr error) error {
	if waitErr == nil {
		return nil
	}
	if detail := strings.TrimSpace(p.stderr.String()); detail != "" {
		return fmt.Errorf("%w: %s", waitErr, detail)
	}
	return waitErr
}

func (p *captureProcess) finish(discardEvents bool) error {
	drainErr := p.awaitDrain()
	if !p.drained {
		p.events.discard()
		go func() {
			<-p.drain
			close(p.events.input)
		}()
		return errors.Join(drainErr, fmt.Errorf("capture events could not close before output drain"))
	}
	if !p.eventsDone {
		close(p.events.input)
		p.eventsDone = true
	}
	if discardEvents {
		p.events.discard()
	}
	timer := time.NewTimer(captureEventDrainTimeout)
	defer timer.Stop()
	select {
	case <-p.events.done:
		return drainErr
	case <-timer.C:
		p.events.discard()
		select {
		case <-p.events.done:
		case <-time.After(captureDrainTimeout):
		}
		return errors.Join(drainErr, fmt.Errorf("capture events did not close within %s", captureEventDrainTimeout))
	}
}

func (p *captureProcess) awaitDrain() error {
	if p.drained {
		return p.drainErr
	}
	timer := time.NewTimer(captureDrainTimeout)
	defer timer.Stop()
	select {
	case p.drainErr = <-p.drain:
		p.drained = true
		_ = p.stdout.Close()
		return p.drainErr
	case <-timer.C:
		_ = p.stdout.Close()
	}
	secondTimer := time.NewTimer(captureDrainTimeout)
	defer secondTimer.Stop()
	select {
	case p.drainErr = <-p.drain:
		p.drained = true
		return errors.Join(fmt.Errorf("capture output required forced close after %s", captureDrainTimeout), p.drainErr)
	case <-secondTimer.C:
		return fmt.Errorf("capture output did not close within %s", 2*captureDrainTimeout)
	}
}

func (p *captureProcess) startupFailure(err error) error {
	if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 126 {
		if msg := strings.TrimSpace(p.stderr.String()); msg != "" {
			return fmt.Errorf("%s", msg)
		}
		return fmt.Errorf("permission denied — check System Settings → Privacy & Security")
	}
	return captureStartFailure(err, p.stderr.String(), p.stdoutTail.String())
}
