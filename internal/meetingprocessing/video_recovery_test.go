package meetingprocessing

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestRecoverVideoKeepsFinalizedEarlyEndAndRecoversPartial(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	dir := t.TempDir()
	meeting := &db.Meeting{Title: "Video recovery", StartedAt: "2026-01-01T00:00:00Z", CaptureStatus: db.CaptureStatusCaptured,
		CaptureStatusUpdatedAt: "2026-01-01T00:00:00Z", ProcessingStatus: db.ProcessingStatusPending, ProcessingStatusUpdatedAt: "2026-01-01T00:00:00Z", AudioPath: &dir, Tags: "[]"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	name := db.VideoFile
	if err := store.UpdateMeetingVideo(meeting.ID, db.VideoUpdate{State: "ended", File: &name}); err != nil {
		t.Fatal(err)
	}
	if err := (Recovery{Store: store}).recoverVideo(context.Background(), "2026-01-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.GetMeeting(meeting.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.VideoState != "ended" {
		t.Fatalf("finalized video changed to %s", loaded.VideoState)
	}
	partial := filepath.Join(dir, db.VideoPartialFile)
	if err := os.WriteFile(partial, []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	first := 104.0
	name = db.VideoPartialFile
	if err := store.UpdateMeetingVideo(meeting.ID, db.VideoUpdate{State: "unfinished", File: &name, OriginHostSec: &first}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateAudioStart(meeting.ID, "mic", 100); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(t.TempDir(), "inspect")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho '{\"type\":\"video_inspected\",\"hostSeconds\":6}'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GAPPD_VIDEO_HELPER_PATH", script)
	if err := (Recovery{Store: store}).recoverVideo(context.Background(), "2026-01-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	loaded, err = store.GetMeeting(meeting.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.VideoState != "ended" || loaded.VideoEndSec == nil || *loaded.VideoEndSec != 10 {
		t.Fatalf("recovered video=%+v", loaded)
	}
	if _, err := os.Stat(filepath.Join(dir, db.VideoFile)); err != nil {
		t.Fatal(err)
	}
}

func TestRecoverVideoRemovesUnplayablePartial(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	dir := t.TempDir()
	meeting := &db.Meeting{Title: "Unplayable", StartedAt: "2026-01-01T00:00:00Z", CaptureStatus: db.CaptureStatusCaptured,
		CaptureStatusUpdatedAt: "2026-01-01T00:00:00Z", ProcessingStatus: db.ProcessingStatusPending, ProcessingStatusUpdatedAt: "2026-01-01T00:00:00Z", AudioPath: &dir, Tags: "[]"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	first, name := 104.0, db.VideoPartialFile
	if err := store.UpdateMeetingVideo(meeting.ID, db.VideoUpdate{State: "unfinished", File: &name, OriginHostSec: &first}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateAudioStart(meeting.ID, "mic", 100); err != nil {
		t.Fatal(err)
	}
	partial := filepath.Join(dir, name)
	if err := os.WriteFile(partial, []byte("bad movie"), 0600); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(t.TempDir(), "inspect")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GAPPD_VIDEO_HELPER_PATH", script)
	if err := (Recovery{Store: store}).recoverVideo(context.Background(), "2026-01-01T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.GetMeeting(meeting.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.VideoState != "failed" || loaded.VideoFile != nil {
		t.Fatalf("failed video=%+v", loaded)
	}
	if _, err := os.Lstat(partial); !os.IsNotExist(err) {
		t.Fatalf("partial still exists: %v", err)
	}
}
