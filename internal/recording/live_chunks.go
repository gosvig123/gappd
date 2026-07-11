package recording

import (
	"context"
	"time"

	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
)

type chunkRecorder interface {
	Chunks() <-chan capture.ChunkEvent
	ChunksComplete() bool
}

const liveChunkDrainTimeout = 5 * time.Second

func (w meetingRecordingWorkflow) startLiveChunkProcessing(recorder audioRecorder, meetingID, language string, processing meetingprocessing.Service) (func() meetingprocessing.LiveChunkResult, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	wait := meetingprocessing.StartLiveChunkProcessing(processing, meetingprocessing.LiveChunkOptions{
		Context: ctx, MeetingID: meetingID, Language: language,
		Chunks: func() <-chan meetingprocessing.CapturedChunk { return capturedChunks(recorderChunks(recorder)) }, ErrOut: w.errOut,
	})
	return wait, cancel
}

func drainLiveChunks(wait func() meetingprocessing.LiveChunkResult, cancel context.CancelFunc, processing meetingprocessing.Service, recorder audioRecorder) meetingprocessing.LiveChunkResult {
	started := time.Now()
	defer cancel()
	result := waitForLiveChunks(wait, cancel)
	result.Dropped = result.Dropped || !recorderChunksComplete(recorder)
	processing.ReportStage(meetingprocessing.StageLiveDrain, time.Since(started))
	return result
}

func waitForLiveChunks(wait func() meetingprocessing.LiveChunkResult, cancel context.CancelFunc) meetingprocessing.LiveChunkResult {
	result := make(chan meetingprocessing.LiveChunkResult, 1)
	go func() { result <- wait() }()
	select {
	case completed := <-result:
		return completed
	case <-time.After(liveChunkDrainTimeout):
		cancel()
		return meetingprocessing.LiveChunkResult{Dropped: true}
	}
}

func recorderChunksComplete(recorder audioRecorder) bool {
	chunker, ok := recorder.(chunkRecorder)
	return ok && chunker.ChunksComplete()
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
	return meetingprocessing.CapturedChunk{
		Path: event.Path, Source: event.Source, Start: event.Start, End: event.End,
		CanonicalStart: event.CanonicalStart, CanonicalEnd: event.CanonicalEnd,
	}
}

func recorderChunks(recorder audioRecorder) <-chan capture.ChunkEvent {
	chunker, ok := recorder.(chunkRecorder)
	if !ok {
		return nil
	}
	return chunker.Chunks()
}
