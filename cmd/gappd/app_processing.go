package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/spf13/cobra"
)

func appProcessingCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "processing", Short: "Durable meeting processing queue"}
	cmd.AddCommand(appProcessingDrainCmd())
	return cmd
}

func appProcessingDrainCmd() *cobra.Command {
	var capability string
	var asJSON bool
	cmd := &cobra.Command{
		Use: "drain", Short: "Drain one processing capability",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app processing drain requires --json")
			}
			return runProcessingDrain(meetingprocessing.Capability(capability))
		},
	}
	cmd.Flags().StringVar(&capability, "capability", "", "transcription, diarization, or summarization")
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	_ = cmd.MarkFlagRequired("capability")
	return cmd
}

func runProcessingDrain(capability meetingprocessing.Capability) error {
	cfg, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	pipeline, err := processingPipeline(cfg, capability)
	if err != nil {
		return err
	}
	service := newMeetingProcessingService(store, pipeline, recordingOutputQuiet)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	result, err := service.Drain(ctx, capability)
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.ProcessingDrainResponse{
		Capability: result.Capability, Attempted: result.Attempted, Completed: result.Completed,
		Requeued: result.Requeued, Failed: result.Failed,
	})
}

func processingPipeline(cfg config.Config, capability meetingprocessing.Capability) (*ai.Pipeline, error) {
	if capability != meetingprocessing.CapabilitySummarization {
		return nil, nil
	}
	provider, err := newAIProvider(cfg.AI)
	if err != nil {
		return nil, err
	}
	return ai.NewPipeline(provider, cfg.AI.Temp), nil
}
