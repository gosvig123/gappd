package main

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/gappd-dev/gappd/internal/recording"
	"github.com/spf13/cobra"
)

func listenCmd() *cobra.Command {
	var deviceIdx int
	var title string
	var mode string
	var language string

	cmd := &cobra.Command{
		Use:   "listen",
		Short: "Record audio and transcribe on stop",
		RunE: func(cmd *cobra.Command, args []string) error {
			m := capture.CaptureMode(mode)
			return runListen(deviceIdx, title, m, language, false)
		},
	}
	cmd.Flags().IntVarP(&deviceIdx, "device", "d", 0, "Audio device index")
	cmd.Flags().StringVarP(&title, "title", "t", "", "Session title")
	cmd.Flags().StringVar(&mode, "mode", "both", "Capture mode: mic, system, or both (default); \"both\" captures mic + system audio for meetings")
	cmd.Flags().StringVar(&language, "language", meetinglang.DefaultCode, "Apple Speech locale for transcript and summary")
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

func runListen(deviceIdx int, title string, mode capture.CaptureMode, language string, desktop bool) error {
	_, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	service, err := newRecordingWorkflowService(store, nil, recordingOutputForListen(desktop), desktop)
	if err != nil {
		return err
	}
	req := recording.Request{DeviceIdx: deviceIdx, Title: title, Mode: mode, Language: language}
	if err := service.Run(req); err != nil || desktop {
		return err
	}
	return drainListenCapabilities(store)
}

func drainListenCapabilities(store *db.DB) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	pipeline := ai.NewPipeline(ai.NewOpenAICompat(cfg.AI.Endpoint, cfg.AI.Model), cfg.AI.Temp)
	service := newMeetingProcessingService(store, pipeline, recordingOutputConsole)
	transcription, err := service.Drain(cmdContext(), meetingprocessing.CapabilityTranscription)
	if err != nil {
		return err
	}
	if err := drainOutcomeError(transcription); err != nil {
		return err
	}
	summarization, err := service.Drain(cmdContext(), meetingprocessing.CapabilitySummarization)
	if err != nil {
		return err
	}
	return drainOutcomeError(summarization)
}

func drainOutcomeError(result meetingprocessing.DrainResult) error {
	if result.Failed > 0 {
		return fmt.Errorf("%s processing failed for %d meeting(s)", result.Capability, result.Failed)
	}
	if result.Requeued > 0 {
		return fmt.Errorf("%s processing remains pending for %d meeting(s)", result.Capability, result.Requeued)
	}
	return nil
}

func recordingOutputForListen(machineReadable bool) recordingOutput {
	if machineReadable {
		return recordingOutputEvents
	}
	return recordingOutputConsole
}
