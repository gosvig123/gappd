package appprotocol

import (
	"encoding/json"
	"io"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/recording"
)

type ConfigResponse struct {
	AI AIConfig `json:"ai"`
}

type AIConfig struct {
	Provider    string  `json:"provider"`
	Model       string  `json:"model"`
	Endpoint    string  `json:"endpoint"`
	Temperature float64 `json:"temperature"`
	Managed     bool    `json:"managed"`
}

type DevicesResponse struct {
	Devices []Device `json:"devices"`
}

type Device struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
}

type MeetingsResponse struct {
	Meetings []MeetingListItem `json:"meetings"`
}

type MeetingResponse struct {
	Meeting MeetingDetail `json:"meeting"`
}

type RecoverStaleRecordingsResponse struct {
	Recovered int `json:"recovered"`
}

type MeetingStatus struct {
	State      db.MeetingState   `json:"state"`
	UpdatedAt  string            `json:"updatedAt"`
	Capture    MeetingStatusInfo `json:"capture"`
	Processing MeetingStatusInfo `json:"processing"`
}

type MeetingStatusInfo struct {
	State          string  `json:"state"`
	UpdatedAt      string  `json:"updatedAt"`
	FailureMessage *string `json:"failureMessage,omitempty"`
}

type RecordingEvent struct {
	Type      recording.EventName `json:"type"`
	MeetingID string              `json:"meetingId"`
	Title     string              `json:"title"`
	Status    MeetingStatus       `json:"status"`
	Error     *string             `json:"error,omitempty"`
}

type RecordingEventEmitter struct {
	enc *json.Encoder
}

func NewRecordingEventEmitter(w io.Writer, enabled bool) *RecordingEventEmitter {
	if !enabled {
		return nil
	}
	return &RecordingEventEmitter{enc: json.NewEncoder(w)}
}

func (e *RecordingEventEmitter) EmitRecordingEvent(name recording.EventName, meeting db.Meeting, err error) error {
	if e == nil {
		return nil
	}
	return e.enc.Encode(NewRecordingEvent(name, meeting, err))
}

func NewRecordingEvent(name recording.EventName, meeting db.Meeting, err error) RecordingEvent {
	event := RecordingEvent{Type: name, MeetingID: meeting.ID, Title: meeting.Title, Status: MeetingStatusFor(meeting)}
	if err != nil {
		message := err.Error()
		event.Error = &message
	}
	return event
}

func MeetingStatusFor(meeting db.Meeting) MeetingStatus {
	updatedAt := meeting.CaptureStatusUpdatedAt
	if db.UsesProcessingTimestamp(meeting) {
		updatedAt = meeting.ProcessingStatusUpdatedAt
	}
	return MeetingStatus{State: db.MeetingStateFor(meeting), UpdatedAt: updatedAt, Capture: CaptureStatusInfo(meeting), Processing: ProcessingStatusInfo(meeting)}
}

func CaptureStatusInfo(meeting db.Meeting) MeetingStatusInfo {
	return MeetingStatusInfo{State: string(meeting.CaptureStatus), UpdatedAt: meeting.CaptureStatusUpdatedAt, FailureMessage: meeting.CaptureFailureMessage}
}

func ProcessingStatusInfo(meeting db.Meeting) MeetingStatusInfo {
	return MeetingStatusInfo{State: string(meeting.ProcessingStatus), UpdatedAt: meeting.ProcessingStatusUpdatedAt, FailureMessage: meeting.ProcessingFailureMessage}
}
