package meetingprocessing

import (
	"context"
	"fmt"
	"math"

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
	sequence := liveChunkSequence{}
	ctx := opts.Context
	if ctx == nil {
		ctx = context.Background()
	}
	for chunk := range chunks {
		processLiveChunk(ctx, processing, opts, sequence, chunk, &completed)
	}
	result <- completed
	close(result)
}

func processLiveChunk(ctx context.Context, processing Service, opts LiveChunkOptions, sequence liveChunkSequence, chunk CapturedChunk, completed *LiveChunkResult) {
	completed.Processed++
	if err := sequence.accept(chunk); err != nil {
		completed.Failed++
		reportLiveChunkError(opts, chunk, err)
		return
	}
	request := liveChunkRequest(opts.MeetingID, opts.Language, chunk)
	if err := processing.ProcessCapturedChunk(ctx, request); err != nil {
		completed.Failed++
		reportLiveChunkError(opts, chunk, err)
	}
}

func liveChunkRequest(meetingID, language string, chunk CapturedChunk) CapturedChunkRequest {
	return CapturedChunkRequest{
		MeetingID: meetingID, Path: chunk.Path, Source: chunk.Source, Language: language,
		Start: chunk.Start, End: chunk.End, CanonicalStart: chunk.CanonicalStart, CanonicalEnd: chunk.CanonicalEnd,
	}
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
	if !validChunkRange(req) {
		return s.processingError("process captured chunk", req.MeetingID, PhaseValidation,
			fmt.Errorf("invalid chunk timestamps: require 0 <= start <= canonical start < canonical end <= end"))
	}
	return nil
}

func validChunkRange(req CapturedChunkRequest) bool {
	values := []float64{req.Start, req.End, req.CanonicalStart, req.CanonicalEnd}
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return req.Start >= 0 && req.Start <= req.CanonicalStart &&
		req.CanonicalStart < req.CanonicalEnd && req.CanonicalEnd <= req.End
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
	return canonicalChunkSegments(offsetSegments(segments, req.Start), req), nil
}

func canonicalChunkSegments(segments []db.Segment, req CapturedChunkRequest) []db.Segment {
	canonical := make([]db.Segment, 0, len(segments))
	for _, segment := range segments {
		midpoint := segment.Start + (segment.End-segment.Start)/2
		if midpoint >= req.CanonicalStart && midpoint < req.CanonicalEnd {
			canonical = append(canonical, segment)
		}
	}
	return canonical
}

func offsetSegments(segments []db.Segment, offset float64) []db.Segment {
	for i := range segments {
		segments[i].Start += offset
		segments[i].End += offset
	}
	return segments
}

func (s Service) insertLiveSegments(segments []db.Segment) error {
	if len(segments) == 0 {
		return nil
	}
	existing, err := s.Store.GetSegments(segments[0].MeetingID)
	if err != nil {
		return fmt.Errorf("read live segments for overlap deduplication: %w", err)
	}
	filtered := removeAdjacentOverlapDuplicates(existing, segments)
	for i := range filtered {
		if err := s.Store.InsertSegment(&filtered[i]); err != nil {
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
