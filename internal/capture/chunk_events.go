package capture

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"sync"

	"github.com/gappd-dev/gappd/internal/livetranscript"
)

const (
	captureReadyEventType            = "capture_ready"
	captureStopAcknowledgedEventType = "capture_stop_acknowledged"
)

type readySignal struct {
	sources []livetranscript.Source
	err     error
}

type diagnosticTail struct {
	mu    sync.Mutex
	limit int
	data  []byte
}

func newDiagnosticTail(limit int) *diagnosticTail {
	return &diagnosticTail{limit: limit}
}

func (b *diagnosticTail) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.data = append(b.data, p...)
	if len(b.data) > b.limit {
		b.data = append([]byte(nil), b.data[len(b.data)-b.limit:]...)
	}
	return len(p), nil
}

func (b *diagnosticTail) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.data)
}

func drainCaptureOutput(reader io.Reader, tail *diagnosticTail, ready chan<- readySignal, stopAcknowledged chan<- struct{}, events chan<- livetranscript.Event) error {
	buffered := bufio.NewReader(reader)
	readySeen := false
	for {
		line, err := buffered.ReadBytes('\n')
		if len(line) > 0 {
			matched, lineErr := routeCaptureLine(bytes.TrimSpace(line), ready, stopAcknowledged, events, &readySeen)
			if !matched {
				_, _ = tail.Write(line)
			}
			if lineErr != nil {
				return lineErr
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("read capture output: %w", err)
		}
	}
}

func routeCaptureLine(line []byte, ready chan<- readySignal, stopAcknowledged chan<- struct{}, events chan<- livetranscript.Event, readySeen *bool) (bool, error) {
	sources, matched, err := decodeCaptureReady(line)
	if matched {
		if *readySeen {
			return true, nil
		}
		*readySeen = err == nil
		ready <- readySignal{sources: sources, err: err}
		return true, nil
	}
	if decodeCaptureStopAcknowledged(line) {
		select {
		case stopAcknowledged <- struct{}{}:
		default:
		}
		return true, nil
	}
	event, matched, err := livetranscript.DecodeEvent(line)
	if !matched {
		return false, nil
	}
	if err != nil {
		event = livetranscript.Dropped(err)
	}
	events <- event
	return true, nil
}

func decodeCaptureReady(line []byte) ([]livetranscript.Source, bool, error) {
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(line, &envelope); err != nil || envelope.Type != captureReadyEventType {
		return nil, false, nil
	}
	var event struct {
		Type    string                  `json:"type"`
		Sources []livetranscript.Source `json:"sources"`
	}
	if err := json.Unmarshal(line, &event); err != nil {
		return nil, true, fmt.Errorf("decode capture readiness: %w", err)
	}
	seen := map[livetranscript.Source]bool{}
	for _, source := range event.Sources {
		if source != livetranscript.SourceMic && source != livetranscript.SourceSystem || seen[source] {
			return nil, true, fmt.Errorf("invalid capture readiness source %q", source)
		}
		seen[source] = true
	}
	if len(event.Sources) == 0 {
		return nil, true, fmt.Errorf("capture readiness requires sources")
	}
	return event.Sources, true, nil
}

func decodeCaptureStopAcknowledged(line []byte) bool {
	var envelope struct {
		Type string `json:"type"`
	}
	return json.Unmarshal(line, &envelope) == nil && envelope.Type == captureStopAcknowledgedEventType
}

func validateReadySources(mode CaptureMode, got []livetranscript.Source) error {
	want := requestedSources(mode)
	got = append([]livetranscript.Source(nil), got...)
	sort.Slice(got, func(i, j int) bool { return got[i] < got[j] })
	sort.Slice(want, func(i, j int) bool { return want[i] < want[j] })
	if len(got) != len(want) {
		return fmt.Errorf("capture readiness sources = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			return fmt.Errorf("capture readiness sources = %v, want %v", got, want)
		}
	}
	return nil
}

func requestedSources(mode CaptureMode) []livetranscript.Source {
	switch mode {
	case ModeMic:
		return []livetranscript.Source{livetranscript.SourceMic}
	case ModeSystem:
		return []livetranscript.Source{livetranscript.SourceSystem}
	default:
		return []livetranscript.Source{livetranscript.SourceMic, livetranscript.SourceSystem}
	}
}
