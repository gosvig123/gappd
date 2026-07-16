package capture

import (
	"bytes"
	"io"

	"github.com/gappd-dev/gappd/internal/livetranscript"
)

type chunkEventWriter struct {
	forward io.Writer
	events  chan<- livetranscript.Event
	buf     bytes.Buffer
}

func newChunkEventWriter(forward io.Writer, events chan<- livetranscript.Event) io.Writer {
	return &chunkEventWriter{forward: forward, events: events}
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
	event, matched, err := livetranscript.DecodeEvent(line)
	if !matched {
		return
	}
	if err != nil {
		event = livetranscript.Dropped(err)
	}
	w.events <- event
}
