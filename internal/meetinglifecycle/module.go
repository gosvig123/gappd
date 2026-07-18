package meetinglifecycle

import (
	"context"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
)

type Module struct{ store *db.DB }

const speakerDiarizationAvailable = false

type RecordingStart struct {
	Title                string
	SessionDir           string
	Language             string
	SpeakerLabelsEnabled *bool
	At                   time.Time
}

type Result struct {
	Meeting *db.Meeting
	Applied bool
}

func New(store *db.DB) Module { return Module{store: store} }

func (w Module) BeginRecording(_ context.Context, start RecordingStart) (*db.Meeting, error) {
	at := timestamp(start.At)
	diarizationState := db.DiarizationStateNotRequested
	if speakerDiarizationAvailable && (start.SpeakerLabelsEnabled == nil || *start.SpeakerLabelsEnabled) {
		diarizationState = db.DiarizationStatePending
	}
	meeting := &db.Meeting{
		Title: start.Title, StartedAt: at, AudioPath: &start.SessionDir,
		CaptureStatus: db.CaptureStatusRecording, CaptureStatusUpdatedAt: at,
		ProcessingStatus: db.ProcessingStatusNotStarted, ProcessingStatusUpdatedAt: at,
		DiarizationState: diarizationState,
		Language:         meetinglang.Normalize(start.Language), Tags: "[]", Source: "listen",
	}
	if err := w.store.CreateMeeting(meeting); err != nil {
		return nil, err
	}
	return meeting, nil
}

func (w Module) Heartbeat(ctx context.Context, id string, at time.Time) (Result, error) {
	result, err := w.store.Conn.ExecContext(ctx, heartbeatSQL, timestamp(at), id, db.CaptureStatusRecording)
	if err != nil {
		return Result{}, fmt.Errorf("update recording heartbeat: %w", err)
	}
	meeting, loadErr := w.store.GetMeeting(id)
	if loadErr != nil {
		return Result{}, loadErr
	}
	rows, rowsErr := result.RowsAffected()
	return Result{Meeting: meeting, Applied: rows > 0}, rowsErr
}

func (w Module) Transition(ctx context.Context, id string, transition Transition) (Result, error) {
	for attempt := 0; attempt < 2; attempt++ {
		result, retry, err := w.apply(ctx, id, transition)
		if err != nil || !retry {
			return result, err
		}
	}
	return Result{}, &ConflictError{MeetingID: id, Transition: transition.name()}
}

func (w Module) apply(ctx context.Context, id string, transition Transition) (Result, bool, error) {
	meeting, err := w.store.GetMeeting(id)
	if err != nil {
		return Result{}, false, err
	}
	before := versionOf(meeting)
	changed, err := transition.apply(meeting)
	if err != nil || !changed {
		return Result{Meeting: meeting, Applied: false}, false, err
	}
	applied, err := updateMeeting(ctx, w.store, meeting, before)
	return Result{Meeting: meeting, Applied: applied}, !applied && err == nil, err
}

func timestamp(at time.Time) string { return at.UTC().Format(time.RFC3339) }

const heartbeatSQL = `UPDATE meetings SET capture_status_updated_at = ? WHERE id = ? AND capture_status = ?`
