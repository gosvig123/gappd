package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetingdocument"
	"github.com/spf13/cobra"
)

// meetingDocumentCmd prints the version-1 cloud document for one local Meeting. It is local
// only: it opens the normal local store and never contacts the network.
func meetingDocumentCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "meeting-document", Short: "Build the cloud document for a local Meeting"}
	var withStamp bool
	exportCmd := &cobra.Command{Use: "export [meeting-id] [revision]", Args: cobra.ExactArgs(2), RunE: func(_ *cobra.Command, args []string) error {
		revision, err := positiveInt(args[1])
		if err != nil {
			return err
		}
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		data, stamp, err := exportMeetingDocumentWithStamp(store, args[0], revision)
		if err != nil {
			return err
		}
		if withStamp {
			envelope, err := json.Marshal(struct {
				Stamp    string          `json:"stamp"`
				Document json.RawMessage `json:"document"`
			}{Stamp: stamp, Document: json.RawMessage(data)})
			if err != nil {
				return fmt.Errorf("Meeting document unavailable")
			}
			_, err = os.Stdout.Write(envelope)
			return err
		}
		_, err = os.Stdout.Write(data)
		return err
	}}
	exportCmd.Flags().BoolVar(&withStamp, "with-stamp", false, "Wrap output with the documentStamp of the exported snapshot")
	cmd.AddCommand(exportCmd)
	return cmd
}

func exportMeetingDocument(store *db.DB, id string, revision int) ([]byte, error) {
	data, _, err := exportMeetingDocumentWithStamp(store, id, revision)
	return data, err
}

func exportMeetingDocumentWithStamp(store *db.DB, id string, revision int) ([]byte, string, error) {
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return nil, "", fmt.Errorf("Meeting document unavailable")
	}
	segments, err := store.GetSegments(id)
	if err != nil {
		return nil, "", fmt.Errorf("Meeting document unavailable")
	}
	data, err := meetingdocument.Build(meeting, segments, revision)
	if err != nil {
		return nil, "", err
	}
	hasSummary := meeting.Summary != nil && strings.TrimSpace(*meeting.Summary) != ""
	return data, appprotocol.DocumentStamp(*meeting, hasSummary), nil
}

func positiveInt(raw string) (int, error) {
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return 0, errors.New("revision must be a positive integer")
	}
	return value, nil
}
