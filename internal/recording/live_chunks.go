package recording

import (
	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
)

type chunkRecorder interface {
	Chunks() <-chan capture.ChunkEvent
}

func (w meetingRecordingWorkflow) startLiveChunkProcessing(recorder audioRecorder, meetingID, language string, processing meetingprocessing.Service) func() {
	return meetingprocessing.StartLiveChunkProcessing(processing, meetingprocessing.LiveChunkOptions{
		MeetingID: meetingID,
		Language:  language,
		Chunks:    func() <-chan meetingprocessing.CapturedChunk { return capturedChunks(recorderChunks(recorder)) },
		ErrOut:    w.errOut,
	})
}

func capturedChunks(events <-chan capture.ChunkEvent) <-chan meetingprocessing.CapturedChunk {
	if events == nil {
		return nil
	}
	chunks := make(chan meetingprocessing.CapturedChunk)
	go func() {
		defer close(chunks)
		for event := range events {
			chunks <- capturedChunk(event)
		}
	}()
	return chunks
}

func capturedChunk(event capture.ChunkEvent) meetingprocessing.CapturedChunk {
	return meetingprocessing.CapturedChunk{Path: event.Path, Source: event.Source, Start: event.Start}
}

func recorderChunks(recorder audioRecorder) <-chan capture.ChunkEvent {
	chunker, ok := recorder.(chunkRecorder)
	if !ok {
		return nil
	}
	return chunker.Chunks()
}
