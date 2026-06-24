package recording

import "github.com/gappd-dev/gappd/internal/db"

type meetingLifecycle struct {
	meeting *db.Meeting
}

func newRecordingMeeting(title, sessionDir, at string) *db.Meeting {
	return &db.Meeting{
		Title: title, StartedAt: at, AudioPath: &sessionDir,
		CaptureStatus: db.CaptureStatusRecording, CaptureStatusUpdatedAt: at,
		ProcessingStatus: db.ProcessingStatusNotStarted, ProcessingStatusUpdatedAt: at,
		Source: "listen",
	}
}

func lifecycleFor(meeting *db.Meeting) meetingLifecycle {
	return meetingLifecycle{meeting: meeting}
}

func (l meetingLifecycle) captureFailed(at string, err error) {
	l.end(at)
	l.capture(db.CaptureStatusFailed, at, err)
}

func (l meetingLifecycle) captured(at string) {
	l.end(at)
	l.capture(db.CaptureStatusCaptured, at, nil)
	l.processing(db.ProcessingStatusProcessing, at, nil)
}

func (l meetingLifecycle) processingStarted(at string) {
	l.processing(db.ProcessingStatusProcessing, at, nil)
}

func (l meetingLifecycle) processingFailed(at string, err error) {
	if l.meeting.EndedAt == nil {
		l.end(at)
	}
	l.processing(db.ProcessingStatusFailed, at, err)
}

func (l meetingLifecycle) transcriptSaved(transcript, at string) {
	l.meeting.Transcript = &transcript
	l.processing(db.ProcessingStatusProcessing, at, nil)
}

func (l meetingLifecycle) processingCompleted(transcript, summary, at string) {
	l.meeting.Transcript = &transcript
	l.meeting.Summary = &summary
	l.processing(db.ProcessingStatusCompleted, at, nil)
}

func (l meetingLifecycle) enhancementFailed(transcript, at string, err error) {
	l.meeting.Transcript = &transcript
	l.processing(db.ProcessingStatusFailed, at, err)
}

func (l meetingLifecycle) end(at string) {
	l.meeting.EndedAt = &at
}

func (l meetingLifecycle) capture(status db.CaptureStatus, at string, err error) {
	l.meeting.CaptureStatus = status
	l.meeting.CaptureStatusUpdatedAt = at
	l.meeting.CaptureFailureMessage = failureMessage(err)
}

func (l meetingLifecycle) processing(status db.ProcessingStatus, at string, err error) {
	l.meeting.ProcessingStatus = status
	l.meeting.ProcessingStatusUpdatedAt = at
	l.meeting.ProcessingFailureMessage = failureMessage(err)
}

func failureMessage(err error) *string {
	if err == nil {
		return nil
	}
	message := err.Error()
	return &message
}
