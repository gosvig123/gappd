package main

import (
	"fmt"
	"os"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/gappd-dev/gappd/internal/recording"
)

type recordingOutput int

const (
	recordingOutputConsole recordingOutput = iota
	recordingOutputEvents
	recordingOutputQuiet
)

func newMeetingProcessingService(store *db.DB, pipeline *ai.Pipeline, output recordingOutput, suppressProcessingFailure bool) meetingprocessing.Service {
	service := meetingprocessing.Service{Store: store, Pipeline: pipeline}
	if output == recordingOutputConsole {
		service.Reporter = meetingprocessing.NewConsoleReporter(os.Stdout, os.Stderr)
	}
	if output == recordingOutputEvents {
		service.Events = processingEventEmitter{appprotocol.NewRecordingEventEmitter(os.Stdout, suppressProcessingFailure)}
	}
	return service
}

type processingEventEmitter struct{ events recording.EventSink }

func (e processingEventEmitter) EmitProcessingEvent(event meetingprocessing.Event) error {
	return e.events.EmitRecordingEvent(recordingEventName(event.Name), event.Meeting, event.Err)
}

func recordingEventName(name meetingprocessing.EventName) recording.EventName {
	switch name {
	case meetingprocessing.EventProcessing:
		return recording.EventProcessing
	case meetingprocessing.EventCompleted:
		return recording.EventCompleted
	default:
		return recording.EventFailed
	}
}

func newRecordingWorkflowService(store *db.DB, pipeline *ai.Pipeline, output recordingOutput, suppressProcessingFailure bool) (recording.Service, error) {
	service := recording.Service{Store: store, Pipeline: pipeline, Out: os.Stdout, ErrOut: os.Stderr}
	service.Processor = newMeetingProcessingService(store, pipeline, output, suppressProcessingFailure)
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
