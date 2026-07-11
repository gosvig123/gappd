package capture

import (
	"io"
	"testing"
)

const validChunkJSON = `{"type":"audio_chunk","source":"mic","path":"/tmp/mic.wav","start":0,"end":305,"canonicalStart":0,"canonicalEnd":300}`

func TestChunkEventWriterReportsDroppedEvent(t *testing.T) {
	dropped := false
	events := make(chan ChunkEvent)
	writer := newChunkEventWriter(io.Discard, events, func() { dropped = true })
	if _, err := writer.Write([]byte(validChunkJSON + "\n")); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if !dropped {
		t.Fatal("dropped = false, want full channel reported")
	}
}

func TestChunkEventWriterReportsInvalidChunk(t *testing.T) {
	dropped := false
	writer := newChunkEventWriter(io.Discard, make(chan ChunkEvent, 1), func() { dropped = true })
	invalid := `{"type":"audio_chunk","source":"mic","path":"x","start":0,"end":1}`
	if _, err := writer.Write([]byte(invalid + "\n")); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if !dropped {
		t.Fatal("invalid chunk event was not reported")
	}
}

func TestParseChunkEvent(t *testing.T) {
	event, ok := parseChunkEvent([]byte(validChunkJSON))
	if !ok {
		t.Fatal("parseChunkEvent() ok = false")
	}
	if event.Start != 0 || event.End != 305 || event.CanonicalStart != 0 || event.CanonicalEnd != 300 {
		t.Fatalf("event = %+v", event)
	}
}

func TestParseChunkEventRejectsInvalidRanges(t *testing.T) {
	cases := []string{
		`{"type":"audio_chunk","source":"mic","path":"x","start":-1,"end":305,"canonicalStart":0,"canonicalEnd":300}`,
		`{"type":"audio_chunk","source":"mic","path":"x","start":0,"end":305,"canonicalStart":300,"canonicalEnd":300}`,
		`{"type":"audio_chunk","source":"mic","path":"x","start":0,"end":305,"canonicalStart":0,"canonicalEnd":306}`,
		`{"type":"audio_chunk","source":"mic","path":"x","start":0,"end":305,"canonicalStart":0,"canonicalEnd":"NaN"}`,
		`{"type":"audio_chunk","source":"unknown","path":"x","start":0,"end":305,"canonicalStart":0,"canonicalEnd":300}`,
	}
	for _, input := range cases {
		if _, ok := parseChunkEvent([]byte(input)); ok {
			t.Fatalf("parseChunkEvent(%s) accepted invalid range", input)
		}
	}
}
