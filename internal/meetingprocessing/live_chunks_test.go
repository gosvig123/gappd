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

	err := service.ProcessCapturedChunk(context.Background(), CapturedChunkRequest{
		MeetingID: meeting.ID, Path: writeChunkAudio(t), Source: "mic", Language: "en-US",
		Start: 30.5, End: 40, CanonicalStart: 30.5, CanonicalEnd: 40,
	})
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
	chunks <- CapturedChunk{Path: filepath.Join(t.TempDir(), "missing.wav"), Source: "mic", End: 1, CanonicalEnd: 1}
	close(chunks)
	wait := StartLiveChunkProcessing(Service{Store: store}, LiveChunkOptions{MeetingID: meeting.ID, Chunks: func() <-chan CapturedChunk { return chunks }})
	result := wait()
	if result.Processed != 1 || result.Failed != 1 || result.Usable() {
		t.Fatalf("result = %+v, want one failed unusable chunk", result)
	}
}

func TestLiveChunkSequenceRejectsCanonicalGap(t *testing.T) {
	sequence := liveChunkSequence{}
	if err := sequence.accept(CapturedChunk{Source: "mic", CanonicalStart: 0, CanonicalEnd: 300}); err != nil {
		t.Fatal(err)
	}
	if err := sequence.accept(CapturedChunk{Source: "system", CanonicalStart: 0, CanonicalEnd: 300}); err != nil {
		t.Fatal(err)
	}
	if err := sequence.accept(CapturedChunk{Source: "mic", CanonicalStart: 600, CanonicalEnd: 900}); err == nil {
		t.Fatal("accepted canonical gap")
	}
}

func TestCanonicalChunkSegmentsUsesAbsoluteMidpointWithoutClamping(t *testing.T) {
	req := CapturedChunkRequest{CanonicalStart: 300, CanonicalEnd: 600}
	segments := []db.Segment{
		{Start: 294, End: 302, Text: "left"},
		{Start: 299, End: 303, Text: "kept"},
		{Start: 598, End: 604, Text: "right"},
	}
	got := canonicalChunkSegments(segments, req)
	if len(got) != 1 || got[0].Text != "kept" || got[0].Start != 299 || got[0].End != 303 {
		t.Fatalf("canonicalChunkSegments() = %+v", got)
	}
}

func TestRemoveAdjacentOverlapDuplicatesIsExactAndSourceSpecific(t *testing.T) {
	existing := []db.Segment{{Start: 299, End: 303, Text: " Hello  WORLD ", Speaker: "Me"}}
	incoming := []db.Segment{
		{Start: 300, End: 304, Text: "hello world", Speaker: "Me"},
		{Start: 301, End: 305, Text: "hello worlds", Speaker: "Me"},
		{Start: 302, End: 306, Text: "hello worlds", Speaker: "Them"},
		{Start: 306, End: 307, Text: "hello worlds", Speaker: "Me"},
	}
	got := removeAdjacentOverlapDuplicates(existing, incoming)
	if len(got) != 3 || got[0].Text != "hello worlds" || got[1].Speaker != "Them" || got[2].Start != 306 {
		t.Fatalf("removeAdjacentOverlapDuplicates() = %+v", got)
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
