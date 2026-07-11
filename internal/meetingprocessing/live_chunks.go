package meetingprocessing

import (
	"context"
	"fmt"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
)

const (
	chunkSourceMic    = "mic"
	chunkSourceSystem = "system"
)

func StartLiveChunkProcessing(processing Service, opts LiveChunkOptions) func() LiveChunkResult {
	if opts.Chunks == nil {
		return emptyLiveChunkResult
	}
	chunks := opts.Chunks()
	if chunks == nil {
		return emptyLiveChunkResult
	}
	result := make(chan LiveChunkResult, 1)
	go processLiveChunks(result, chunks, processing, opts)
	return func() LiveChunkResult { return <-result }
}

func emptyLiveChunkResult() LiveChunkResult { return LiveChunkResult{} }

func processLiveChunks(result chan<- LiveChunkResult, chunks <-chan CapturedChunk, processing Service, opts LiveChunkOptions) {
	completed := LiveChunkResult{}
	for chunk := range chunks {
		completed.Processed++
		request := liveChunkRequest(opts.MeetingID, opts.Language, chunk)
		if err := processing.ProcessCapturedChunk(context.Background(), request); err != nil {
			completed.Failed++
			reportLiveChunkError(opts, chunk, err)
		}
	}
	result <- completed
	close(result)
}

func liveChunkRequest(meetingID, language string, chunk CapturedChunk) CapturedChunkRequest {
	return CapturedChunkRequest{MeetingID: meetingID, Path: chunk.Path, Source: chunk.Source, Start: chunk.Start, Language: language}
}

func reportLiveChunkError(opts LiveChunkOptions, chunk CapturedChunk, err error) {
	if opts.ErrOut == nil {
		return
	}
	fmt.Fprintf(opts.ErrOut, "warning: live transcription skipped %s chunk %.1fs: %v\n", chunk.Source, chunk.Start, err)
}

func (s Service) ProcessCapturedChunk(ctx context.Context, req CapturedChunkRequest) error {
	if err := s.validateCapturedChunk(req); err != nil {
		return err
	}
	segments, err := s.transcribeChunk(ctx, req)
	if err != nil {
		return err
	}
	return s.insertLiveSegments(segments)
}

func (s Service) validateCapturedChunk(req CapturedChunkRequest) error {
	if err := s.requireChunkProcessing(); err != nil {
		return err
	}
	if req.MeetingID == "" || req.Path == "" || speakerForChunkSource(req.Source) == "" {
		return s.processingError("process captured chunk", req.MeetingID, PhaseValidation, ErrNoAudio)
	}
	return nil
}

func (s Service) requireChunkProcessing() error {
	if s.Store == nil {
		return fmt.Errorf("meeting processing: store is required")
	}
	return nil
}

func (s Service) transcribeChunk(ctx context.Context, req CapturedChunkRequest) ([]db.Segment, error) {
	source := audioartifact.Source{Path: req.Path, Speaker: speakerForChunkSource(req.Source)}
	segments, err := s.transcribeSource(ctx, source, req.MeetingID, req.Language)
	if err != nil {
		return nil, fmt.Errorf("%s chunk %.1fs: %w", req.Source, req.Start, err)
	}
	return offsetSegments(segments, req.Start), nil
}

func offsetSegments(segments []db.Segment, offset float64) []db.Segment {
	for i := range segments {
		segments[i].Start += offset
		segments[i].End += offset
	}
	return segments
}

func (s Service) insertLiveSegments(segments []db.Segment) error {
	for i := range segments {
		if err := s.Store.InsertSegment(&segments[i]); err != nil {
			return fmt.Errorf("insert live segment: %w", err)
		}
	}
	return nil
}

func speakerForChunkSource(source string) string {
	switch source {
	case chunkSourceMic:
		return audioartifact.MicSpeaker
	case chunkSourceSystem:
		return audioartifact.SystemSpeaker
	default:
		return ""
	}
}
