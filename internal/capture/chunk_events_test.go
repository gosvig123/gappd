package capture

import (
	"io"
	"testing"

	"github.com/gappd-dev/gappd/internal/livetranscript"
)

const validChunkJSON = `{"type":"audio_chunk","source":"mic","path":"/tmp/mic.wav","start":0,"end":305,"canonicalStart":0,"canonicalEnd":300}`

func TestChunkEventWriterForwardsLiveTranscriptEvent(t *testing.T) {
	events := make(chan livetranscript.Event, 1)
	writer := newChunkEventWriter(io.Discard, events)
	if _, err := writer.Write([]byte(validChunkJSON + "\n")); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if event := <-events; event.Kind != livetranscript.EventChunk {
		t.Fatalf("event kind = %q", event.Kind)
	}
}

func TestChunkEventWriterConvertsInvalidEventToDrop(t *testing.T) {
	events := make(chan livetranscript.Event, 1)
	writer := newChunkEventWriter(io.Discard, events)
	invalid := `{"type":"audio_chunk","source":"mic","path":"x","start":0,"end":1}`
	if _, err := writer.Write([]byte(invalid + "\n")); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if event := <-events; event.Kind != livetranscript.EventDropped {
		t.Fatalf("event kind = %q, want dropped", event.Kind)
	}
}
