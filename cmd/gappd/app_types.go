package main

import (
	"encoding/json"
	"os"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/recording"
)

type appConfigResponse struct {
	AI appAIConfig `json:"ai"`
}

type appAIConfig struct {
	Provider    string  `json:"provider"`
	Model       string  `json:"model"`
	Endpoint    string  `json:"endpoint"`
	Temperature float64 `json:"temperature"`
	Managed     bool    `json:"managed"`
}

type appDevicesResponse struct {
	Devices []captureDevice `json:"devices"`
}

type captureDevice struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
}

type appMeetingsResponse struct {
	Meetings []appMeetingListItem `json:"meetings"`
}

type appMeetingListItem = meetingListView

type appMeetingStatus struct {
	State      db.MeetingState      `json:"state"`
	UpdatedAt  string               `json:"updatedAt"`
	Capture    appMeetingStatusInfo `json:"capture"`
	Processing appMeetingStatusInfo `json:"processing"`
}

type appMeetingStatusInfo struct {
	State          string  `json:"state"`
	UpdatedAt      string  `json:"updatedAt"`
	FailureMessage *string `json:"failureMessage,omitempty"`
}

type appMeetingResponse struct {
	Meeting appMeetingDetail `json:"meeting"`
}

type appMeetingDetail = meetingDetailView

type appRecordingEvent struct {
	Type      recording.EventName `json:"type"`
	MeetingID string              `json:"meetingId"`
	Title     string              `json:"title"`
	Status    appMeetingStatus    `json:"status"`
	Error     *string             `json:"error,omitempty"`
}

type appRecordingEventEmitter struct {
	enc *json.Encoder
}

func newAppRecordingEventEmitter(enabled bool) *appRecordingEventEmitter {
	if !enabled {
		return nil
	}
	return &appRecordingEventEmitter{enc: json.NewEncoder(os.Stdout)}
}

func (e *appRecordingEventEmitter) emit(name recording.EventName, meeting db.Meeting, err error) error {
	if e == nil {
		return nil
	}
	event := appRecordingEvent{
		Type:      name,
		MeetingID: meeting.ID,
		Title:     meeting.Title,
		Status:    appMeetingStatusFor(meeting),
	}
	if err != nil {
		message := err.Error()
		event.Error = &message
	}
	return e.enc.Encode(event)
}

func appMeetingStatusFor(meeting db.Meeting) appMeetingStatus {
	updatedAt := meeting.CaptureStatusUpdatedAt
	if db.UsesProcessingTimestamp(meeting) {
		updatedAt = meeting.ProcessingStatusUpdatedAt
	}
	return appMeetingStatus{State: db.MeetingStateFor(meeting), UpdatedAt: updatedAt, Capture: captureStatusInfo(meeting), Processing: processingStatusInfo(meeting)}
}

func captureStatusInfo(meeting db.Meeting) appMeetingStatusInfo {
	return appMeetingStatusInfo{State: string(meeting.CaptureStatus), UpdatedAt: meeting.CaptureStatusUpdatedAt, FailureMessage: meeting.CaptureFailureMessage}
}

func processingStatusInfo(meeting db.Meeting) appMeetingStatusInfo {
	return appMeetingStatusInfo{State: string(meeting.ProcessingStatus), UpdatedAt: meeting.ProcessingStatusUpdatedAt, FailureMessage: meeting.ProcessingFailureMessage}
}
