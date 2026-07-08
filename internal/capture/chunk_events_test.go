package capture

import "testing"

func TestParseChunkEvent(t *testing.T) {
	event, ok := parseChunkEvent([]byte(`{"type":"audio_chunk","source":"mic","path":"/tmp/mic.wav","start":1.5,"end":31.5}`))
	if !ok {
		t.Fatal("parseChunkEvent() ok = false")
	}
	if event.Source != "mic" || event.Path != "/tmp/mic.wav" || event.Start != 1.5 || event.End != 31.5 {
		t.Fatalf("event = %+v", event)
	}
}
