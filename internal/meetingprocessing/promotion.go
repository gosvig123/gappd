package meetingprocessing

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

type ProvisionalTranscriptStore interface {
	GetSegments(string) ([]db.Segment, error)
	PromoteProvisionalTranscript(context.Context, string, string, time.Time) (bool, error)
}

// PromoteProvisionalTranscript publishes successful live chunks while leaving
// durable processing pending for summarization.
func (s Service) PromoteProvisionalTranscript(ctx context.Context, meetingID string) error {
	store, ok := s.Store.(ProvisionalTranscriptStore)
	if !ok {
		return fmt.Errorf("promote provisional transcript: atomic store required")
	}
	segments, err := store.GetSegments(meetingID)
	if err != nil {
		return err
	}
	transcript := FormatTranscript(segments)
	if strings.TrimSpace(transcript) == "" {
		return nil
	}
	_, err = store.PromoteProvisionalTranscript(ctx, meetingID, transcript, s.now())
	return err
}
