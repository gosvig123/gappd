package main

import (
	"fmt"
	"os"

	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/recording"
	"github.com/spf13/cobra"
)

func listenCmd() *cobra.Command {
	var deviceIdx int
	var title string
	var modelPath string
	var mode string

	cmd := &cobra.Command{
		Use:   "listen",
		Short: "Record audio and transcribe on stop",
		RunE: func(cmd *cobra.Command, args []string) error {
			m := capture.CaptureMode(mode)
			return runListen(deviceIdx, title, modelPath, m, false)
		},
	}
	cmd.Flags().IntVarP(&deviceIdx, "device", "d", 0, "Audio device index")
	cmd.Flags().StringVarP(&title, "title", "t", "", "Session title")
	cmd.Flags().StringVarP(&modelPath, "model", "m", "", "Whisper model path")
	cmd.Flags().StringVar(&mode, "mode", "both", "Capture mode: mic, system, or both (default); \"both\" captures mic + system audio for meetings")
	return cmd
}

func devicesCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "devices",
		Short: "List available audio input devices",
		RunE: func(cmd *cobra.Command, args []string) error {
			devices, err := capture.ListAudioDevices()
			if err != nil {
				return err
			}
			for _, d := range devices {
				fmt.Printf("  [%d] %s\n", d.Index, d.Name)
			}
			return nil
		},
	}
}

func runListen(deviceIdx int, title, modelPath string, mode capture.CaptureMode, suppressProcessingFailure bool) error {
	_, store, pipeline, err := loadDeps()
	if err != nil {
		return err
	}
	defer store.Close()

	defaultPath, err := defaultModelPath()
	if err != nil {
		return err
	}
	if modelPath == "" {
		modelPath = defaultPath
	}
	baseDir, err := config.GappdDir()
	if err != nil {
		return fmt.Errorf("resolve gappd dir for session path: %w", err)
	}

	var events recording.EventSink
	if emitter := newAppRecordingEventEmitter(suppressProcessingFailure); emitter != nil {
		events = appRecordingSink{emitter}
	}
	service := recording.Service{
		Store:    store,
		Pipeline: pipeline,
		BaseDir:  baseDir,
		Out:      os.Stdout,
		ErrOut:   os.Stderr,
		Events:   events,
	}
	return service.Run(recording.Request{
		DeviceIdx:                 deviceIdx,
		Title:                     title,
		ModelPath:                 modelPath,
		DefaultModelPath:          defaultPath,
		Mode:                      mode,
		LiveTranscript:            suppressProcessingFailure,
		SuppressProcessingFailure: suppressProcessingFailure,
	})
}

type appRecordingSink struct {
	emitter *appRecordingEventEmitter
}

func (s appRecordingSink) EmitRecordingEvent(name recording.EventName, meeting db.Meeting, err error) error {
	return s.emitter.emit(name, meeting, err)
}
