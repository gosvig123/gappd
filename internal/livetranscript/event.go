package livetranscript

import (
	"encoding/json"
	"fmt"
	"math"
)

type EventKind string

type Source string

const (
	EventChunk          EventKind = "audio_chunk"
	EventSourceComplete EventKind = "audio_chunk_source_complete"
	EventStreamComplete EventKind = "audio_chunk_stream_complete"
	EventDropped        EventKind = "audio_chunk_dropped"

	SourceMic    Source = "mic"
	SourceSystem Source = "system"
)

type Event struct {
	Kind           EventKind `json:"type"`
	Source         Source    `json:"source,omitempty"`
	Path           string    `json:"path,omitempty"`
	Start          float64   `json:"start,omitempty"`
	End            float64   `json:"end,omitempty"`
	CanonicalStart float64   `json:"canonicalStart,omitempty"`
	CanonicalEnd   float64   `json:"canonicalEnd,omitempty"`
	Count          int       `json:"count,omitempty"`
	Sources        []Source  `json:"sources,omitempty"`
	Error          string    `json:"error,omitempty"`
}

func DecodeEvent(line []byte) (Event, bool, error) {
	var envelope struct {
		Kind EventKind `json:"type"`
	}
	if err := json.Unmarshal(line, &envelope); err != nil {
		return Event{}, false, nil
	}
	if !knownEventKind(envelope.Kind) {
		return Event{}, false, nil
	}
	var event Event
	if err := json.Unmarshal(line, &event); err != nil {
		return Event{}, true, err
	}
	return event, true, validateEvent(event)
}

func Dropped(reason error) Event {
	return Event{Kind: EventDropped, Error: reason.Error()}
}

func knownEventKind(kind EventKind) bool {
	return kind == EventChunk || kind == EventSourceComplete || kind == EventStreamComplete
}

func validateEvent(event Event) error {
	switch event.Kind {
	case EventChunk:
		return validateChunk(event)
	case EventSourceComplete:
		return validateSourceComplete(event)
	case EventStreamComplete:
		return validateStreamComplete(event)
	default:
		return fmt.Errorf("unknown Live Transcript event %q", event.Kind)
	}
}

func validateChunk(event Event) error {
	if !validSource(event.Source) || event.Path == "" {
		return fmt.Errorf("invalid Live Transcript chunk source or path")
	}
	values := []float64{event.Start, event.End, event.CanonicalStart, event.CanonicalEnd}
	if !finite(values) || event.Start < 0 || event.Start > event.CanonicalStart {
		return fmt.Errorf("invalid Live Transcript chunk range")
	}
	if event.CanonicalStart >= event.CanonicalEnd || event.CanonicalEnd > event.End {
		return fmt.Errorf("invalid Live Transcript canonical range")
	}
	return nil
}

func validateSourceComplete(event Event) error {
	if !validSource(event.Source) || event.Count < 0 {
		return fmt.Errorf("invalid Live Transcript source completion")
	}
	if !finite([]float64{event.CanonicalEnd}) || event.CanonicalEnd < 0 {
		return fmt.Errorf("invalid Live Transcript source completion range")
	}
	return nil
}

func validateStreamComplete(event Event) error {
	if len(event.Sources) == 0 {
		return fmt.Errorf("Live Transcript stream completion requires sources")
	}
	seen := map[Source]bool{}
	for _, source := range event.Sources {
		if !validSource(source) || seen[source] {
			return fmt.Errorf("invalid Live Transcript stream source %q", source)
		}
		seen[source] = true
	}
	return nil
}

func finite(values []float64) bool {
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}

func validSource(source Source) bool {
	return source == SourceMic || source == SourceSystem
}
