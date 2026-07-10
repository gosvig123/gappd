package meetingprocessing

import (
	"context"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

func (s Service) markProcessing(ctx context.Context, meeting *db.Meeting, req StoredRequest) error {
	if meeting.ProcessingStatus != db.ProcessingStatusProcessing {
		transition := s.storedStartTransition(meeting, req)
		updated, err := s.transition(ctx, meeting.ID, transition)
		if err != nil {
			return s.processingError("enhance stored", meeting.ID, PhaseLifecycle, err)
		}
		*meeting = *updated
	}
	return s.emit(EventProcessing, meeting, nil)
}

func (s Service) storedStartTransition(meeting *db.Meeting, req StoredRequest) meetinglifecycle.Transition {
	if meeting.ProcessingStatus == db.ProcessingStatusNotStarted {
		return meetinglifecycle.ProcessingStarted{At: s.now()}
	}
	return meetinglifecycle.ProcessingRestarted{At: s.now(), Reason: reprocessingReason(meeting, req)}
}

func reprocessingReason(meeting *db.Meeting, req StoredRequest) meetinglifecycle.ReprocessingReason {
	if meeting.ProcessingStatus == db.ProcessingStatusFailed {
		return meetinglifecycle.ReprocessingRetry
	}
	if wantsRefinement(req) {
		return meetinglifecycle.ReprocessingRefinement
	}
	return meetinglifecycle.ReprocessingEnhancement
}
