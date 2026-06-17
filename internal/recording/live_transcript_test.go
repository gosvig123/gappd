package recording

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestSourceLiveChunksSkipsOpenLatestChunk(t *testing.T) {
	dir := t.TempDir()
	chunksDir := filepath.Join(dir, chunkDirName)
	if err := os.MkdirAll(chunksDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	writeChunk(t, chunksDir, "mic-000000.wav", minWAVSize+2)
	writeChunk(t, chunksDir, "mic-000001.wav", minWAVSize+2)

	chunks, err := sourceLiveChunks(audioSource{path: filepath.Join(dir, "mic.wav"), speaker: "You"}, map[string]bool{})
	if err != nil {
		t.Fatalf("sourceLiveChunks() error = %v", err)
	}
	if len(chunks) != 1 || chunks[0].start != 0 {
		t.Fatalf("chunks = %#v, want only first closed chunk", chunks)
	}
}

func TestLiveChunkWindowUsesPreviousChunkContext(t *testing.T) {
	dir := t.TempDir()
	chunksDir := filepath.Join(dir, chunkDirName)
	if err := os.MkdirAll(chunksDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	writeChunk(t, chunksDir, "mic-000000.wav", minWAVSize+2)
	writeChunk(t, chunksDir, "mic-000001.wav", minWAVSize+2)

	window, err := liveChunkWindow(liveChunk{path: filepath.Join(chunksDir, "mic-000001.wav"), start: liveChunkDuration.Seconds()})
	if err != nil {
		t.Fatalf("liveChunkWindow() error = %v", err)
	}
	defer window.cleanup()
	data, err := os.ReadFile(window.path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if window.cutoff != liveChunkDuration.Seconds() || binary.LittleEndian.Uint32(data[40:44]) != 4 {
		t.Fatalf("window cutoff=%v data=%d, want two chunks", window.cutoff, binary.LittleEndian.Uint32(data[40:44]))
	}
}

func TestSaveLiveTranscriptKeepsRecordingState(t *testing.T) {
	store := newFakeStore()
	meeting := &db.Meeting{ID: "live", CaptureStatus: db.CaptureStatusRecording, ProcessingStatus: db.ProcessingStatusNotStarted}
	store.meeting = meeting
	service := Service{store: store}
	if err := service.saveLiveTranscript(meeting, "[You] hello\n"); err != nil {
		t.Fatalf("saveLiveTranscript() error = %v", err)
	}
	if store.meeting.ProcessingStatus != db.ProcessingStatusNotStarted {
		t.Fatalf("processing_status = %q", store.meeting.ProcessingStatus)
	}
}

func writeChunk(t *testing.T, dir, name string, size int) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), make([]byte, size), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
}
