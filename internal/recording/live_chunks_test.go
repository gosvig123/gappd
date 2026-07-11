package recording

import (
	"testing"

	"github.com/gappd-dev/gappd/internal/capture"
)

func TestCapturedChunkForwardsWindowAndCanonicalTimestamps(t *testing.T) {
	event := capture.ChunkEvent{
		Path: "chunk.wav", Source: "mic", Start: 295, End: 605,
		CanonicalStart: 300, CanonicalEnd: 600,
	}
	chunk := capturedChunk(event)
	if chunk.Start != 295 || chunk.End != 605 || chunk.CanonicalStart != 300 || chunk.CanonicalEnd != 600 {
		t.Fatalf("capturedChunk() = %+v", chunk)
	}
}
