package main

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/appprotocol"
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
	cmd.Flags().StringVar(&capability, "capability", "", "transcription or summarization")
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	_ = cmd.MarkFlagRequired("capability")
	return cmd
}

func runProcessingDrain(capability meetingprocessing.Capability) error {
	_, store, pipeline, err := loadDeps()
	if err != nil {
		return err
	}
	defer store.Close()
	service := newMeetingProcessingService(store, pipeline, recordingOutputQuiet)
	result, err := service.Drain(cmdContext(), capability)
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.ProcessingDrainResponse{
		Capability: result.Capability, Attempted: result.Attempted, Completed: result.Completed,
		Requeued: result.Requeued, Failed: result.Failed, Cleaned: result.Cleaned, CleanupFailed: result.CleanupFailed,
	})
}
