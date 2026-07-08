package recording

import (
	"context"
	"fmt"

	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
)

type chunkRecorder interface {
	Chunks() <-chan capture.ChunkEvent
}

func (w meetingRecordingWorkflow) startLiveChunkProcessing(recorder audioRecorder, meetingID, language string, processing meetingprocessing.CapturedProcessor) func() {
	processor, ok := processing.(meetingprocessing.LiveChunkProcessor)
	chunks := recorderChunks(recorder)
	if !ok || chunks == nil {
		return func() {}
	}
	done := make(chan struct{})
	go w.processLiveChunks(done, chunks, processor, meetingID, language)
	return func() { <-done }
}

func (w meetingRecordingWorkflow) processLiveChunks(done chan<- struct{}, chunks <-chan capture.ChunkEvent, processor meetingprocessing.LiveChunkProcessor, meetingID, language string) {
	defer close(done)
	for event := range chunks {
		request := liveChunkRequest(meetingID, language, event)
		if err := processor.ProcessCapturedChunk(context.Background(), request); err != nil {
			w.reportLiveChunkError(event, err)
		}
	}
}

func liveChunkRequest(meetingID, language string, event capture.ChunkEvent) meetingprocessing.CapturedChunkRequest {
	return meetingprocessing.CapturedChunkRequest{MeetingID: meetingID, Path: event.Path, Source: event.Source, Start: event.Start, Language: language}
}

func recorderChunks(recorder audioRecorder) <-chan capture.ChunkEvent {
	chunker, ok := recorder.(chunkRecorder)
	if !ok {
		return nil
	}
	return chunker.Chunks()
}

func (w meetingRecordingWorkflow) reportLiveChunkError(event capture.ChunkEvent, err error) {
	if w.errOut == nil {
		return
	}
	fmt.Fprintf(w.errOut, "warning: live transcription skipped %s chunk %.1fs: %v\n", event.Source, event.Start, err)
}
