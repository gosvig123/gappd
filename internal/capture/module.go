package capture

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/livetranscript"
)

type CaptureMode string

const (
	ModeMic    CaptureMode = "mic"
	ModeSystem CaptureMode = "system"
	ModeBoth   CaptureMode = "both"

	captureHelperEnv          = "GAPPD_CAPTURE_HELPER_PATH"
	captureChunkSecondsEnv    = "GAPPD_CAPTURE_CHUNK_SECONDS"
	captureChunkOverlapEnv    = "GAPPD_CAPTURE_CHUNK_OVERLAP_SECONDS"
	captureStartupTimeout     = 15 * time.Second
	captureStopTimeout        = 5 * time.Second
	captureStartupStopTimeout = 2 * time.Second
	captureDrainTimeout       = 2 * time.Second
	captureEventDrainTimeout  = 2 * time.Second
	captureEventBufferSize    = 64
)

type NoticeKind string

const (
	NoticeReady         NoticeKind = "ready"
	NoticeStopRequested NoticeKind = "stop_requested"
)

type Notice struct {
	Kind             NoticeKind
	TranscriptEvents <-chan livetranscript.Event
}

type Observe func(Notice)

type Input struct {
	Mode        CaptureMode
	OutputDir   string
	DeviceIndex int
}

type Result struct {
	Artifacts   audioartifact.Artifacts
	StopWarning error
}

type Module struct{}

func New() Module { return Module{} }

func (m Module) Run(ctx context.Context, input Input, observe Observe) (Result, error) {
	result := Result{Artifacts: audioartifact.New(input.OutputDir)}
	if err := validateInput(ctx, input); err != nil {
		return result, err
	}
	if observe == nil {
		return result, fmt.Errorf("capture observer is required")
	}
	process, err := m.start(input)
	if err != nil {
		return result, err
	}

	if err := process.awaitReady(ctx, input.Mode); err != nil {
		return result, err
	}
	observe(Notice{Kind: NoticeReady, TranscriptEvents: process.events.output})
	if process.waited {
		return result, process.finishUnexpected(process.waitErr)
	}

	select {
	case waitErr := <-process.wait:
		process.recordWait(waitErr)
		return result, process.finishUnexpected(waitErr)
	case <-ctx.Done():
		select {
		case waitErr := <-process.wait:
			process.recordWait(waitErr)
			return result, process.finishUnexpected(waitErr)
		default:
		}
	}

	observe(Notice{Kind: NoticeStopRequested})
	waitErr, stopWarning, stopDelivered := process.requestStop()
	finishErr := process.finish(false)
	stopAcknowledged := process.stopWasAcknowledged()
	if !stopDelivered || !stopAcknowledged {
		var ackErr error
		if !stopAcknowledged {
			ackErr = fmt.Errorf("capture helper did not acknowledge requested stop")
		}
		return result, process.unexpectedError(waitErr, errors.Join(ackErr, stopWarning, finishErr))
	}
	if artifactErr := validateArtifacts(input.Mode, result.Artifacts); artifactErr != nil {
		return result, errors.Join(artifactErr, stopWarning, process.exitError(waitErr), finishErr)
	}
	result.StopWarning = errors.Join(stopWarning, process.exitError(waitErr), finishErr)
	return result, nil
}

func validateInput(ctx context.Context, input Input) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if input.OutputDir == "" {
		return fmt.Errorf("capture output directory is required")
	}
	switch input.Mode {
	case ModeMic, ModeSystem, ModeBoth:
		return nil
	default:
		return fmt.Errorf("invalid capture mode %q", input.Mode)
	}
}

func validateArtifacts(mode CaptureMode, artifacts audioartifact.Artifacts) error {
	switch {
	case mode != ModeSystem && !artifacts.HasMicrophoneAudio():
		return fmt.Errorf("microphone audio was not captured")
	case mode != ModeMic && !artifacts.HasSystemAudio():
		return fmt.Errorf("system audio was not captured")
	default:
		return nil
	}
}
