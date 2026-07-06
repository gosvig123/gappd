package main

import (
	"fmt"
	"os"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/recording"
)

type recordingOutput int

const (
	recordingOutputConsole recordingOutput = iota
	recordingOutputEvents
	recordingOutputQuiet
)

func newRecordingService(store *db.DB, pipeline *ai.Pipeline, output recordingOutput) recording.Service {
	service := recording.Service{Store: store, Pipeline: pipeline, Out: os.Stdout, ErrOut: os.Stderr}
	if output == recordingOutputConsole {
		service.Reporter = recording.NewConsoleProcessingReporter(os.Stdout, os.Stderr)
	}
	return service
}

func newRecordingWorkflowService(store *db.DB, pipeline *ai.Pipeline, output recordingOutput, suppressProcessingFailure bool) (recording.Service, error) {
	service := newRecordingService(store, pipeline, output)
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
