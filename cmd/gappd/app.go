package main

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/spf13/cobra"
)

const speakerLabelingRetryUnavailableMessage = "speaker labeling retry is not available for this meeting"

func appCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "app",
		Short: "Machine-readable commands for the desktop app",
	}
	cmd.AddCommand(appConfigCmd(), appDevicesCmd(), appMeetingsCmd(), appProcessingCmd(), appRecordCmd())
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
	cmd.AddCommand(appMeetingsListCmd(), appMeetingsShowCmd(), appMeetingsRetryDiarizationCmd(), appMeetingsDeleteCmd())
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
	var mode string
	var language string
	var speakerLabelsEnabled bool

	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start a recording for the desktop app",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runListen(deviceIdx, title, capture.CaptureMode(mode), language, &speakerLabelsEnabled, true)
		},
	}
	cmd.Flags().IntVar(&deviceIdx, "device", 0, "Audio device index")
	cmd.Flags().StringVar(&title, "title", "", "Session title")
	cmd.Flags().StringVar(&mode, "mode", string(capture.ModeBoth), "Capture mode: mic, system, or both")
	cmd.Flags().StringVar(&language, "language", meetinglang.DefaultCode, "Apple Speech locale for transcript and summary")
	cmd.Flags().BoolVar(&speakerLabelsEnabled, "speaker-labels-enabled", true, "Run speaker labeling before summary")
	return cmd
}

func appRecordRecoverStaleCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "recover-stale",
		Short: "Recover stale desktop recordings",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAppRecoverStale(asJSON)
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func runAppRecoverStale(asJSON bool) error {
	if !asJSON {
		return fmt.Errorf("app record recover-stale requires --json")
	}
	_, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	recovered, err := recoverStaleRecordings(store)
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.RecoverStaleRecordingsResponse{Recovered: recovered})
}

func recoverStaleRecordings(store *db.DB) (int, error) {
	recovery := meetingprocessing.Recovery{Store: store, Lifecycle: meetinglifecycle.New(store)}
	return recovery.RecoverStale(cmdContext(), meetingprocessing.RecoveryOptions{})
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

func appMeetingsRetryDiarizationCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{Use: "retry-diarization [meeting-id]", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		if !asJSON {
			return fmt.Errorf("app meetings retry-diarization requires --json")
		}
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		result, err := meetinglifecycle.New(store).RetryDiarization(cmdContext(), args[0], time.Now())
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New(speakerLabelingRetryUnavailableMessage)
		}
		if err != nil {
			return err
		}
		if !result.Applied {
			return errors.New(speakerLabelingRetryUnavailableMessage)
		}
		detail, err := appMeetingDetailFor(store, args[0])
		if err != nil {
			return err
		}
		return writeJSON(appprotocol.MeetingResponse{Meeting: detail})
	}}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func appMeetingDetailFor(store *db.DB, id string) (appprotocol.MeetingDetail, error) {
	meeting, segments, err := loadMeetingDetail(store, id)
	if err != nil {
		return appprotocol.MeetingDetail{}, err
	}
	return appprotocol.BuildAppMeetingDetail(*meeting, segments), nil
}

func loadMeetingDetail(store *db.DB, id string) (*db.Meeting, []db.Segment, error) {
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return nil, nil, fmt.Errorf("meeting not found: %w", err)
	}
	segments, err := store.GetSegments(id)
	return meeting, segments, err
}
