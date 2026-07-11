package capture

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
)

type ChunkEvent struct {
	Type           string  `json:"type"`
	Source         string  `json:"source"`
	Path           string  `json:"path"`
	Start          float64 `json:"start"`
	End            float64 `json:"end"`
	CanonicalStart float64 `json:"canonicalStart"`
	CanonicalEnd   float64 `json:"canonicalEnd"`
}

const chunkEventType = "audio_chunk"

type chunkEventWriter struct {
	forward io.Writer
	events  chan<- ChunkEvent
	onDrop  func()
	buf     bytes.Buffer
}

func newChunkEventWriter(forward io.Writer, events chan<- ChunkEvent, onDrop func()) io.Writer {
	return &chunkEventWriter{forward: forward, events: events, onDrop: onDrop}
}

func (w *chunkEventWriter) Write(p []byte) (int, error) {
	if w.forward != nil {
		if _, err := w.forward.Write(p); err != nil {
			return 0, err
		}
	}
	w.bufferLines(p)
	return len(p), nil
}

func (w *chunkEventWriter) bufferLines(p []byte) {
	for _, b := range p {
		if b == '\n' {
			w.consumeLine()
			continue
		}
		w.buf.WriteByte(b)
	}
}

func (w *chunkEventWriter) consumeLine() {
	line := bytes.TrimSpace(w.buf.Bytes())
	w.buf.Reset()
	if len(line) == 0 {
		return
	}
	if event, ok := parseChunkEvent(line); ok {
		w.sendEvent(event)
	} else if isChunkEventLine(line) && w.onDrop != nil {
		w.onDrop()
	}
}

func (w *chunkEventWriter) sendEvent(event ChunkEvent) {
	select {
	case w.events <- event:
	default:
		if w.onDrop != nil {
			w.onDrop()
		}
	}
}

func isChunkEventLine(line []byte) bool {
	var envelope struct {
		Type string `json:"type"`
	}
	return json.Unmarshal(line, &envelope) == nil && envelope.Type == chunkEventType
}

func parseChunkEvent(line []byte) (ChunkEvent, bool) {
	var event ChunkEvent
	if json.Unmarshal(line, &event) != nil {
		return ChunkEvent{}, false
	}
	return event, validChunkEvent(event)
}

func validChunkEvent(event ChunkEvent) bool {
	values := []float64{event.Start, event.End, event.CanonicalStart, event.CanonicalEnd}
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	validRange := event.Start >= 0 && event.Start <= event.CanonicalStart &&
		event.CanonicalStart < event.CanonicalEnd && event.CanonicalEnd <= event.End
	validSource := event.Source == string(ModeMic) || event.Source == string(ModeSystem)
	return event.Type == chunkEventType && event.Path != "" && validSource && validRange
}
