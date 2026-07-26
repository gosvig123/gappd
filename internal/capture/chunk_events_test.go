package capture

import (
	"reflect"
	"testing"

	"github.com/gappd-dev/gappd/internal/livetranscript"
)

func TestDecodeCaptureReady(t *testing.T) {
	sources, matched, err := decodeCaptureReady([]byte(`{"type":"capture_ready","sources":["mic","system"]}`))
	want := []livetranscript.Source{livetranscript.SourceMic, livetranscript.SourceSystem}
	if err != nil || !matched || !reflect.DeepEqual(sources, want) {
		t.Fatalf("decodeCaptureReady() = %v, %v, %v", sources, matched, err)
	}
}

func TestDecodeCaptureReadyRejectsInvalidSources(t *testing.T) {
	for _, input := range []string{
		`{"type":"capture_ready","sources":[]}`,
		`{"type":"capture_ready","sources":["mic","mic"]}`,
		`{"type":"capture_ready","sources":["other"]}`,
	} {
		if _, matched, err := decodeCaptureReady([]byte(input)); !matched || err == nil {
			t.Fatalf("decodeCaptureReady(%s) matched=%v error=%v", input, matched, err)
		}
	}
}

func TestRouteCaptureLineForwardsLiveTranscriptEvent(t *testing.T) {
	ready := make(chan readySignal, 1)
	stopAcknowledged := make(chan struct{}, 1)
	events := make(chan livetranscript.Event, 1)
	readySeen := false
	line := []byte(`{"type":"audio_chunk","source":"mic","path":"/tmp/mic.wav","start":0,"end":305,"canonicalStart":0,"canonicalEnd":300}`)
	matched, err := routeCaptureLine(line, ready, stopAcknowledged, events, &readySeen)
	if err != nil || !matched {
		t.Fatalf("routeCaptureLine() matched=%v error=%v", matched, err)
	}
	if event := <-events; event.Kind != livetranscript.EventChunk {
		t.Fatalf("event kind = %q", event.Kind)
	}
}

func TestRouteCaptureLineSignalsStopAcknowledgement(t *testing.T) {
	ready := make(chan readySignal, 1)
	stopAcknowledged := make(chan struct{}, 1)
	events := make(chan livetranscript.Event, 1)
	readySeen := false
	matched, err := routeCaptureLine([]byte(`{"type":"capture_stop_acknowledged"}`), ready, stopAcknowledged, events, &readySeen)
	if err != nil || !matched {
		t.Fatalf("routeCaptureLine() matched=%v error=%v", matched, err)
	}
	select {
	case <-stopAcknowledged:
	default:
		t.Fatal("stop acknowledgement was not signaled")
	}
}

func TestRouteCaptureLineConvertsInvalidEventToDrop(t *testing.T) {
	ready := make(chan readySignal, 1)
	stopAcknowledged := make(chan struct{}, 1)
	events := make(chan livetranscript.Event, 1)
	readySeen := false
	line := []byte(`{"type":"audio_chunk","source":"mic","path":"x","start":0,"end":1}`)
	_, _ = routeCaptureLine(line, ready, stopAcknowledged, events, &readySeen)
	if event := <-events; event.Kind != livetranscript.EventDropped {
		t.Fatalf("event kind = %q, want dropped", event.Kind)
	}
}
