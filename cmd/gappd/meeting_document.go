package main

import (
	"errors"
	"fmt"
	"os"
	"strconv"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetingdocument"
	"github.com/spf13/cobra"
)

// meetingDocumentCmd prints the version-1 cloud document for one local Meeting. It is local
// only: it opens the normal local store and never contacts the network.
func meetingDocumentCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "meeting-document", Short: "Build the cloud document for a local Meeting"}
	cmd.AddCommand(&cobra.Command{Use: "export [meeting-id] [revision]", Args: cobra.ExactArgs(2), RunE: func(_ *cobra.Command, args []string) error {
		revision, err := positiveInt(args[1])
		if err != nil {
			return err
		}
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		data, err := exportMeetingDocument(store, args[0], revision)
		if err != nil {
			return err
		}
		_, err = os.Stdout.Write(data)
		return err
	}})
	return cmd
}

func exportMeetingDocument(store *db.DB, id string, revision int) ([]byte, error) {
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return nil, fmt.Errorf("Meeting document unavailable")
	}
	segments, err := store.GetSegments(id)
	if err != nil {
		return nil, fmt.Errorf("Meeting document unavailable")
	}
	return meetingdocument.Build(meeting, segments, revision)
}

func positiveInt(raw string) (int, error) {
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return 0, errors.New("revision must be a positive integer")
	}
	return value, nil
}
