package meetingprocessing

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
)

func TestProcessCapturedChunkPersistsOffsetSegments(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createRecordingMeeting(t, store)
	service := Service{Store: store, Transcriber: fakeTranscriber{}}

	err := service.ProcessCapturedChunk(context.Background(), CapturedChunkRequest{MeetingID: meeting.ID, Path: writeChunkAudio(t), Source: "mic", Start: 30.5, Language: "en-US"})
	if err != nil {
		t.Fatalf("ProcessCapturedChunk() error = %v", err)
	}
	segments, err := store.GetSegments(meeting.ID)
	if err != nil {
		t.Fatalf("GetSegments() error = %v", err)
	}
	assertLiveChunkSegment(t, segments)
}

func TestLiveChunkResultRejectsFailedChunk(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createRecordingMeeting(t, store)
	chunks := make(chan CapturedChunk, 1)
	chunks <- CapturedChunk{Path: filepath.Join(t.TempDir(), "missing.wav"), Source: "mic"}
	close(chunks)
	wait := StartLiveChunkProcessing(Service{Store: store}, LiveChunkOptions{MeetingID: meeting.ID, Chunks: func() <-chan CapturedChunk { return chunks }})
	result := wait()
	if result.Processed != 1 || result.Failed != 1 || result.Usable() {
		t.Fatalf("result = %+v, want one failed unusable chunk", result)
	}
}

func writeChunkAudio(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mic-000001.wav")
	if err := os.WriteFile(path, []byte(strings.Repeat("m", 45)), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return path
}

func assertLiveChunkSegment(t *testing.T, segments []db.Segment) {
	t.Helper()
	if len(segments) != 1 {
		t.Fatalf("segments = %d, want 1", len(segments))
	}
	if segments[0].Start != 30.5 || segments[0].End != 31.5 || segments[0].Speaker != audioartifact.MicSpeaker {
		t.Fatalf("segment = %+v", segments[0])
	}
}
