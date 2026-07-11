package main

import (
	"fmt"
	"os"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/gappd-dev/gappd/internal/recording"
)

type recordingOutput int

const (
	recordingOutputConsole recordingOutput = iota
	recordingOutputEvents
	recordingOutputQuiet
)

func newMeetingProcessingService(store *db.DB, pipeline *ai.Pipeline, output recordingOutput) meetingprocessing.Service {
	service := meetingprocessing.Service{Store: store, Lifecycle: meetinglifecycle.New(store), Pipeline: pipeline}
	switch output {
	case recordingOutputConsole:
		service.Reporter = meetingprocessing.NewConsoleReporter(os.Stdout, os.Stderr)
	case recordingOutputEvents:
		service.Reporter = meetingprocessing.NewTimingReporter(os.Stderr)
	}
	return service
}

func newRecordingWorkflowService(store *db.DB, pipeline *ai.Pipeline, output recordingOutput, suppressProcessingFailure bool) (recording.Service, error) {
	lifecycle := meetinglifecycle.New(store)
	processing := newMeetingProcessingService(store, pipeline, output)
	service := recording.New(lifecycle, processing)
	service.Out = os.Stdout
	service.ErrOut = os.Stderr
	baseDir, err := config.GappdDir()
	if err != nil {
		return recording.Service{}, fmt.Errorf("resolve gappd dir for session path: %w", err)
	}
	service.BaseDir = baseDir
	if output == recordingOutputEvents {
		service.Events = appprotocol.NewRecordingEventEmitter(os.Stdout, suppressProcessingFailure)
	}
	return service, nil
}
