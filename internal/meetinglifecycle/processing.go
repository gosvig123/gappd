package meetinglifecycle

import (
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

type ProcessingStarted struct{ At time.Time }

func (ProcessingStarted) name() string { return "processing_started" }

func (t ProcessingStarted) apply(meeting *db.Meeting) (bool, error) {
	if meeting.ProcessingStatus == db.ProcessingStatusProcessing {
		return false, nil
	}
	if meeting.CaptureStatus != db.CaptureStatusCaptured || meeting.ProcessingStatus != db.ProcessingStatusNotStarted {
		return false, conflict(meeting, t.name())
	}
	setProcessing(meeting, db.ProcessingStatusProcessing, timestamp(t.At), nil)
	return true, nil
}

type ReprocessingReason string

const (
	ReprocessingRetry       ReprocessingReason = "retry"
	ReprocessingRefinement  ReprocessingReason = "refinement"
	ReprocessingEnhancement ReprocessingReason = "enhancement"
)

type ProcessingRestarted struct {
	At     time.Time
	Reason ReprocessingReason
}

func (ProcessingRestarted) name() string { return "processing_restarted" }

func (t ProcessingRestarted) apply(meeting *db.Meeting) (bool, error) {
	if meeting.ProcessingStatus == db.ProcessingStatusProcessing {
		return false, nil
	}
	if meeting.CaptureStatus != db.CaptureStatusCaptured || !validRestartReason(t.Reason) || !canRestart(meeting.ProcessingStatus) {
		return false, conflict(meeting, t.name())
	}
	setProcessing(meeting, db.ProcessingStatusProcessing, timestamp(t.At), nil)
	return true, nil
}

func validRestartReason(reason ReprocessingReason) bool {
	return reason == ReprocessingRetry || reason == ReprocessingRefinement || reason == ReprocessingEnhancement
}

func canRestart(status db.ProcessingStatus) bool {
	return status == db.ProcessingStatusCompleted || status == db.ProcessingStatusFailed
}

func processingActive(meeting *db.Meeting) bool {
	return meeting.CaptureStatus == db.CaptureStatusCaptured &&
		(meeting.ProcessingStatus == db.ProcessingStatusProcessing || meeting.ProcessingStatus == db.ProcessingStatusPending)
}

type TranscriptSaved struct {
	At         time.Time
	Transcript string
}

func (TranscriptSaved) name() string { return "transcript_saved" }

func (t TranscriptSaved) apply(meeting *db.Meeting) (bool, error) {
	if !processingActive(meeting) {
		return false, conflict(meeting, t.name())
	}
	if sameText(meeting.Transcript, t.Transcript) {
		return false, nil
	}
	meeting.Transcript = &t.Transcript
	meeting.TranscriptRevision++
	setProcessing(meeting, db.ProcessingStatusProcessing, timestamp(t.At), nil)
	return true, nil
}

type ProcessingRequeued struct{ At time.Time }

func (ProcessingRequeued) name() string { return "processing_requeued" }
func (t ProcessingRequeued) apply(meeting *db.Meeting) (bool, error) {
	if meeting.ProcessingStatus == db.ProcessingStatusPending {
		return false, nil
	}
	if !processingActive(meeting) {
		return false, conflict(meeting, t.name())
	}
	setProcessing(meeting, db.ProcessingStatusPending, timestamp(t.At), nil)
	return true, nil
}

type ProcessingFailed struct {
	At         time.Time
	Cause      error
	Transcript *string
}

func (ProcessingFailed) name() string { return "processing_failed" }

func (t ProcessingFailed) apply(meeting *db.Meeting) (bool, error) {
	if t.Cause == nil {
		return false, fmt.Errorf("%s transition requires cause", t.name())
	}
	message := t.Cause.Error()
	if processingFailureMatches(meeting, message, t.Transcript) {
		return false, nil
	}
	if !processingActive(meeting) {
		return false, conflict(meeting, t.name())
	}
	if t.Transcript != nil && !sameText(meeting.Transcript, *t.Transcript) {
		meeting.Transcript = t.Transcript
		meeting.TranscriptRevision++
	}
	setProcessing(meeting, db.ProcessingStatusFailed, timestamp(t.At), t.Cause)
	return true, nil
}

func processingFailureMatches(meeting *db.Meeting, message string, transcript *string) bool {
	if meeting.ProcessingStatus != db.ProcessingStatusFailed || !sameText(meeting.ProcessingFailureMessage, message) {
		return false
	}
	return transcript == nil || sameText(meeting.Transcript, *transcript)
}

type Completion struct {
	Title          string
	Transcript     string
	Summary        string
	ExtractionJSON string
	At             time.Time
}

type ProcessingCompleted struct{ Completion Completion }

func (ProcessingCompleted) name() string { return "processing_completed" }

func (t ProcessingCompleted) apply(meeting *db.Meeting) (bool, error) {
	completion := t.Completion
	if completionMatches(meeting, completion) {
		return false, nil
	}
	if !processingActive(meeting) {
		return false, conflict(meeting, t.name())
	}
	applyCompletion(meeting, completion)
	return true, nil
}

func applyCompletion(meeting *db.Meeting, completion Completion) {
	if title := cleanGeneratedMeetingTitle(completion.Title); title != "" {
		meeting.Title = title
	}
	if !sameText(meeting.Transcript, completion.Transcript) {
		meeting.Transcript = &completion.Transcript
		meeting.TranscriptRevision++
	}
	meeting.Summary = &completion.Summary
	meeting.SummaryTranscriptRevision = meeting.TranscriptRevision
	meeting.ExtractionJSON = &completion.ExtractionJSON
	setProcessing(meeting, db.ProcessingStatusCompleted, timestamp(completion.At), nil)
}

func completionMatches(meeting *db.Meeting, completion Completion) bool {
	copy := *meeting
	applyCompletion(&copy, completion)
	return meeting.ProcessingStatus == db.ProcessingStatusCompleted && sameCompletion(meeting, &copy)
}

func sameCompletion(a, b *db.Meeting) bool {
	return a.Title == b.Title && samePointers(a.Transcript, b.Transcript) && a.TranscriptRevision == b.TranscriptRevision &&
		samePointers(a.Summary, b.Summary) && a.SummaryTranscriptRevision == b.SummaryTranscriptRevision &&
		samePointers(a.ExtractionJSON, b.ExtractionJSON)
}

func samePointers(a, b *string) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}
