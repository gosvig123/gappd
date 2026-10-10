package db

import (
	"context"
	"path/filepath"
	"testing"
)

func TestFailedVideoWithPartialRemainsRecoverable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "meetings.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	meeting := &Meeting{Title: "Interrupted", StartedAt: "2026-01-01T00:00:00Z", CaptureStatus: CaptureStatusCaptured,
		CaptureStatusUpdatedAt: "2026-01-01T00:00:00Z", ProcessingStatus: ProcessingStatusPending,
		ProcessingStatusUpdatedAt: "2026-01-01T00:00:00Z", Tags: "[]"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	partial := VideoPartialFile
	if err := store.UpdateMeetingVideo(meeting.ID, VideoUpdate{State: "recording", File: &partial}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateMeetingVideo(meeting.ID, VideoUpdate{State: "failed"}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateMeetingVideo(meeting.ID, VideoUpdate{State: "unfinished", File: &partial}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	meetings, err := store.ListInterruptedVideoMeetings("2026-01-02T00:00:00Z", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(meetings) != 1 || meetings[0].ID != meeting.ID || meetings[0].VideoFile == nil || *meetings[0].VideoFile != partial {
		t.Fatalf("recovery candidates: %+v", meetings)
	}
}

func TestMeetingVideoMigrationAndMeasuredInterval(t *testing.T) {
	path := filepath.Join(t.TempDir(), "meetings.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	meeting := &Meeting{Title: "Video", StartedAt: "2026-01-01T00:00:00Z", CaptureStatus: CaptureStatusRecording, ProcessingStatus: ProcessingStatusPending,
		CaptureStatusUpdatedAt: "2026-01-01T00:00:00Z", ProcessingStatusUpdatedAt: "2026-01-01T00:00:00Z", Tags: "[]"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	start, end := 102.5, 108.5
	source, name := "window", VideoPartialFile
	if err := store.UpdateMeetingVideo(meeting.ID, VideoUpdate{State: "recording", SourceType: &source, File: &name, OriginHostSec: &start, EndHostSec: &end}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateAudioStart(meeting.ID, "system", 100); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateVideoInterval(meeting.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateAudioStart(meeting.ID, "mic", 99); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateVideoInterval(meeting.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.GetMeeting(meeting.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.VideoState != "recording" || loaded.VideoFile == nil || *loaded.VideoFile != name || loaded.VideoStartSec == nil || *loaded.VideoStartSec != 3.5 || loaded.VideoEndSec == nil || *loaded.VideoEndSec != 9.5 {
		t.Fatalf("video after reopen: %+v", loaded)
	}
	conn, err := store.Conn.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var count int
	if err := conn.QueryRowContext(context.Background(), `SELECT count(*) FROM migrations WHERE name='meeting_screen_video'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("migration count=%d err=%v", count, err)
	}
}
