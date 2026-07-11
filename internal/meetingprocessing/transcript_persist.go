package meetingprocessing

import (
	"context"
	"errors"

	"github.com/gappd-dev/gappd/internal/db"
)

func (s Service) saveSegments(ctx context.Context, meeting *db.Meeting, segments []db.Segment) (string, error) {
	s.report().SegmentsSaved(len(segments))
	return s.commitDirectTranscript(ctx, meeting, segments, FormatTranscript(segments))
}

func (s Service) saveLiveSegments(ctx context.Context, meeting *db.Meeting, segments []db.Segment) (string, error) {
	s.report().SegmentsReused(len(segments))
	return s.commitDirectTranscript(ctx, meeting, nil, FormatTranscript(segments))
}

func (s Service) commitDirectTranscript(ctx context.Context, meeting *db.Meeting, segments []db.Segment, transcript string) (string, error) {
	store, ok := s.Store.(AtomicTranscriptStore)
	if !ok {
		return "", s.processingError("process captured", meeting.ID, PhasePersist, errors.New("atomic transcript store required"))
	}
	committed, err := store.CommitDirectTranscript(ctx, meeting.ID, transcript, segments, s.now())
	if err != nil || !committed {
		stale := errors.New("stale processing claim")
		return "", s.processingError("process captured", meeting.ID, PhasePersist, errors.Join(err, stale))
	}
	updated, err := s.Store.GetMeeting(meeting.ID)
	if err != nil {
		return "", err
	}
	*meeting = *updated
	s.report().TranscriptSaved(transcript)
	return transcript, nil
}
