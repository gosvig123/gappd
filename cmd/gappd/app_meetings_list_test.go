package main

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
)

func TestMeetingListIncludesHistoryBeyondFifty(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	_, store, err := loadStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for i := 0; i < 61; i++ {
		err := store.CreateMeeting(&db.Meeting{ID: fmt.Sprintf("meeting-%d", i), Title: "Meeting", StartedAt: "2026-09-14T12:00:00Z", CaptureStatus: db.CaptureStatusCaptured, ProcessingStatus: db.ProcessingStatusCompleted, Tags: "[]", Source: "listen"})
		if err != nil {
			t.Fatal(err)
		}
	}
	output, err := os.CreateTemp(t.TempDir(), "meetings.json")
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	original := os.Stdout
	os.Stdout = output
	defer func() { os.Stdout = original }()
	cmd := appMeetingsListCmd()
	cmd.SetArgs([]string{"--json"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if _, err := output.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	var response appprotocol.MeetingsResponse
	if err := json.NewDecoder(output).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if len(response.Meetings) != 61 {
		t.Fatalf("listed %d Meetings, want all 61", len(response.Meetings))
	}
}
