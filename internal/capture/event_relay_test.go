package capture

import (
	"testing"

	"github.com/gappd-dev/gappd/internal/livetranscript"
)

func TestEventRelayBoundsStalledConsumerQueue(t *testing.T) {
	relay := newEventRelay()
	inputCount := captureEventBufferSize + captureEventQueueLimit + 20
	for range inputCount {
		relay.input <- livetranscript.Event{Kind: livetranscript.EventChunk}
	}
	close(relay.input)

	count, dropped := 0, 0
	for event := range relay.output {
		count++
		if event.Kind == livetranscript.EventDropped {
			dropped++
		}
	}
	if count > captureEventBufferSize+captureEventQueueLimit {
		t.Fatalf("relayed %d events beyond bounded capacity", count)
	}
	if dropped != 1 {
		t.Fatalf("dropped markers = %d, want 1", dropped)
	}
}
