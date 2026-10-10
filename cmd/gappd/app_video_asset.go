package main

import (
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/video"
	"github.com/spf13/cobra"
)

func appVideoAssetCmd() *cobra.Command {
	return meetingJSONCommand("video-asset [meeting-id]", cobra.ExactArgs(1), func(args []string) error {
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		return writeVideoAsset(store, args[0])
	})
}

func writeVideoAsset(store *db.DB, id string) error {
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return err
	}
	root, err := config.GappdDir()
	if err != nil {
		return err
	}
	path, err := video.AssetPath(root, *meeting)
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.VideoAssetResponse{Path: path, StartSec: meeting.VideoStartSec, EndSec: meeting.VideoEndSec})
}
