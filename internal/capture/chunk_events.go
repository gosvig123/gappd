package capture

import (
	"bytes"
	"encoding/json"
	"io"
)

type ChunkEvent struct {
	Type   string  `json:"type"`
	Source string  `json:"source"`
	Path   string  `json:"path"`
	Start  float64 `json:"start"`
	End    float64 `json:"end"`
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
		select {
		case w.events <- event:
		default:
			if w.onDrop != nil {
				w.onDrop()
			}
		}
	}
}

func parseChunkEvent(line []byte) (ChunkEvent, bool) {
	var event ChunkEvent
	if json.Unmarshal(line, &event) != nil {
		return ChunkEvent{}, false
	}
	return event, event.Type == chunkEventType && event.Path != "" && event.Source != ""
}
