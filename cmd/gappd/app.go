package main

import (
	"fmt"
	"os"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/recording"
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
			out := make([]appprotocol.Device, 0, len(devices))
			for _, device := range devices {
				out = append(out, appprotocol.Device{Index: device.Index, Name: device.Name})
			}
			return writeJSON(appprotocol.DevicesResponse{Devices: out})
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
	cmd.AddCommand(appMeetingsListCmd(), appMeetingsShowCmd(), appMeetingsDeleteCmd())
	return cmd
}

func appRecordCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "record",
		Short: "Machine-readable recording entrypoints",
	}
	cmd.AddCommand(appRecordStartCmd(), appRecordRecoverStaleCmd())
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

func appRecordRecoverStaleCmd() *cobra.Command {
	var asJSON bool
	var modelPath string
	cmd := &cobra.Command{
		Use:   "recover-stale",
		Short: "Recover stale desktop recordings",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAppRecoverStale(asJSON, modelPath)
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	cmd.Flags().StringVar(&modelPath, "model", "", "Whisper model path")
	return cmd
}

func runAppRecoverStale(asJSON bool, modelPath string) error {
	if !asJSON {
		return fmt.Errorf("app record recover-stale requires --json")
	}
	_, store, pipeline, err := loadDeps()
	if err != nil {
		return err
	}
	defer store.Close()
	recovered, err := recoverStaleRecordings(store, pipeline, modelPath)
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.RecoverStaleRecordingsResponse{Recovered: recovered})
}

func recoverStaleRecordings(store *db.DB, pipeline *ai.Pipeline, modelPath string) (int, error) {
	defaultPath, err := defaultModelPath()
	if err != nil {
		return 0, err
	}
	if modelPath == "" {
		modelPath = defaultPath
	}
	service := recording.Service{Store: store, Pipeline: pipeline, Out: os.Stdout, ErrOut: os.Stderr}
	return service.RecoverStale(cmdContext(), recording.RecoverStaleOptions{ModelPath: modelPath, DefaultModelPath: defaultPath, SuppressProcessingFailure: true})
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
			entries, err := store.ListMeetingEntries(50)
			if err != nil {
				return err
			}
			return writeJSON(appprotocol.MeetingsResponse{Meetings: appprotocol.BuildMeetingListViews(entries)})
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
			return writeJSON(appprotocol.MeetingResponse{Meeting: detail})
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func appMeetingDetailFor(store *db.DB, id string) (appprotocol.MeetingDetail, error) {
	return appprotocol.BuildAppMeetingDetailView(store, id)
}
