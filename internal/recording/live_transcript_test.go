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
	writeWAVChunk(t, chunksDir, "mic-000000.wav", 8000, 16000)
	writeWAVChunk(t, chunksDir, "mic-000001.wav", 8000, 16000)

	window, err := liveChunkWindow(liveChunk{path: filepath.Join(chunksDir, "mic-000001.wav"), start: 1})
	if err != nil {
		t.Fatalf("liveChunkWindow() error = %v", err)
	}
	defer window.cleanup()
	data, err := os.ReadFile(window.path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	assertJoinedWAV(t, data, window.start)
}

func TestReplaceLiveWindowKeepsStablePrefix(t *testing.T) {
	segments := []db.Segment{{Speaker: "You", Start: 0, End: 4}, {Speaker: "You", Start: 4, End: 7}, {Speaker: "Other", Start: 5, End: 8}}
	out := replaceLiveWindow(segments, "You", 5)
	if len(out) != 2 || out[0].End != 4 || out[1].Speaker != "Other" {
		t.Fatalf("segments = %#v, want stable You prefix and other speaker", out)
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

func writeWAVChunk(t *testing.T, dir, name string, sampleRate, dataSize uint32) {
	t.Helper()
	data := append(liveWAVHeader(testWAVHeader(sampleRate), int64(dataSize)), make([]byte, dataSize)...)
	if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
}

func testWAVHeader(sampleRate uint32) []byte {
	header := make([]byte, minWAVSize)
	copy(header[0:4], "RIFF")
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	binary.LittleEndian.PutUint32(header[16:20], 16)
	binary.LittleEndian.PutUint16(header[20:22], 1)
	binary.LittleEndian.PutUint16(header[22:24], 1)
	binary.LittleEndian.PutUint32(header[24:28], sampleRate)
	binary.LittleEndian.PutUint32(header[28:32], sampleRate*2)
	binary.LittleEndian.PutUint16(header[32:34], 2)
	binary.LittleEndian.PutUint16(header[34:36], 16)
	copy(header[36:40], "data")
	return header
}

func assertJoinedWAV(t *testing.T, data []byte, start float64) {
	t.Helper()
	if start != 0 || binary.LittleEndian.Uint32(data[24:28]) != 8000 || binary.LittleEndian.Uint32(data[40:44]) != 32000 {
		t.Fatalf("joined wav start=%v rate=%d data=%d", start, binary.LittleEndian.Uint32(data[24:28]), binary.LittleEndian.Uint32(data[40:44]))
	}
}
