package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/spf13/cobra"
)

func appMeetingsDeleteCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "delete [meeting-id]",
		Short: "Delete a saved meeting as JSON",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAppMeetingsDelete(args[0], asJSON)
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func runAppMeetingsDelete(id string, asJSON bool) error {
	if !asJSON {
		return fmt.Errorf("app meetings delete requires --json")
	}
	_, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	response, err := appDeleteMeeting(store, id)
	if err != nil {
		return err
	}
	return writeJSON(response)
}

func appDeleteMeeting(store *db.DB, id string) (appprotocol.MeetingDeleteResponse, error) {
	meeting, err := store.DeleteMeeting(id)
	if err != nil {
		return appprotocol.MeetingDeleteResponse{}, err
	}
	return appprotocol.MeetingDeleteResponse{DeletedID: meeting.ID, ArtifactWarning: removeMeetingArtifacts(meeting.AudioPath)}, nil
}

func removeMeetingArtifacts(sessionDir *string) *string {
	if sessionDir == nil || *sessionDir == "" {
		return nil
	}
	if err := removeMeetingArtifactDir(*sessionDir); err != nil {
		message := err.Error()
		return &message
	}
	return nil
}

func removeMeetingArtifactDir(sessionDir string) error {
	root, err := config.GappdDir()
	if err != nil {
		return fmt.Errorf("resolve artifact root: %w", err)
	}
	cleaned, err := filepath.Abs(sessionDir)
	if err != nil {
		return fmt.Errorf("resolve artifact path %q: %w", sessionDir, err)
	}
	sessionsRoot := filepath.Join(root, "sessions")
	if ok, err := pathInside(cleaned, sessionsRoot); err != nil || !ok {
		return unsafeArtifactPathError(cleaned, sessionsRoot, err)
	}
	if err := os.RemoveAll(cleaned); err != nil {
		return fmt.Errorf("delete artifacts %s: %w", cleaned, err)
	}
	return nil
}

func pathInside(path, root string) (bool, error) {
	cleanRoot, err := filepath.Abs(root)
	if err != nil {
		return false, fmt.Errorf("resolve sessions root %q: %w", root, err)
	}
	rel, err := filepath.Rel(cleanRoot, path)
	if err != nil {
		return false, fmt.Errorf("compare artifact path %q to %q: %w", path, cleanRoot, err)
	}
	return rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)), nil
}

func unsafeArtifactPathError(path, root string, err error) error {
	if err != nil {
		return err
	}
	return fmt.Errorf("skip artifact delete %s: outside %s", path, root)
}
