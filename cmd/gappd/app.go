package main

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/spf13/cobra"
)

func appCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "app",
		Short: "Machine-readable commands for the desktop app",
	}
	cmd.AddCommand(appConfigCmd(), appDevicesCmd(), appMeetingsCmd(), appRecordCmd())
	return cmd
}

func appDevicesCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "devices",
		Short: "List available audio input devices as JSON",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app devices requires --json")
			}
			devices, err := capture.ListAudioDevices()
			if err != nil {
				return err
			}
			out := make([]captureDevice, 0, len(devices))
			for _, device := range devices {
				out = append(out, captureDevice{Index: device.Index, Name: device.Name})
			}
			return writeJSON(appDevicesResponse{Devices: out})
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func appMeetingsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "meetings",
		Short: "Machine-readable meeting access",
	}
	cmd.AddCommand(appMeetingsListCmd(), appMeetingsShowCmd())
	return cmd
}

func appRecordCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "record",
		Short: "Machine-readable recording entrypoints",
	}
	cmd.AddCommand(appRecordStartCmd())
	return cmd
}

func appRecordStartCmd() *cobra.Command {
	var deviceIdx int
	var title string
	var modelPath string
	var mode string

	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start a recording for the desktop app",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runListen(deviceIdx, title, modelPath, capture.CaptureMode(mode), true)
		},
	}
	cmd.Flags().IntVar(&deviceIdx, "device", 0, "Audio device index")
	cmd.Flags().StringVar(&title, "title", "", "Session title")
	cmd.Flags().StringVar(&modelPath, "model", "", "Whisper model path")
	cmd.Flags().StringVar(&mode, "mode", string(capture.ModeBoth), "Capture mode: mic, system, or both")
	return cmd
}

func appMeetingsListCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List saved meetings as JSON",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app meetings list requires --json")
			}
			_, store, err := loadStore()
			if err != nil {
				return err
			}
			defer store.Close()
			meetings, err := store.ListMeetings(50)
			if err != nil {
				return err
			}
			return writeJSON(appMeetingsResponse{Meetings: buildMeetingListViews(meetings)})
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func appMeetingsShowCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "show [meeting-id]",
		Short: "Show a meeting with transcript and summary as JSON",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app meetings show requires --json")
			}
			_, store, err := loadStore()
			if err != nil {
				return err
			}
			defer store.Close()
			detail, err := appMeetingDetailFor(store, args[0])
			if err != nil {
				return err
			}
			return writeJSON(appMeetingResponse{Meeting: detail})
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func appMeetingDetailFor(store *db.DB, id string) (appMeetingDetail, error) {
	return buildMeetingDetailView(store, id)
}
