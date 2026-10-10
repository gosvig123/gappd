package appprotocol

import (
	"encoding/json"
	"io"
	"sync"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/gappd-dev/gappd/internal/recording"
)

type ConfigResponse struct {
	AI AIConfig `json:"ai"`
}

type CodexStatusResponse struct {
	AI        AIConfig `json:"ai"`
	Available bool     `json:"available"`
	Error     *string  `json:"error,omitempty"`
}

type AIConfig struct {
	Provider             string  `json:"provider"`
	Model                string  `json:"model"`
	Endpoint             string  `json:"endpoint"`
	Temperature          float64 `json:"temperature"`
	Managed              bool    `json:"managed"`
	CodexExecutable      string  `json:"codexExecutable"`
	CodexModel           string  `json:"codexModel"`
	CodexReasoningEffort string  `json:"codexReasoningEffort"`
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

// Path is for Electron main only; renderer IPC must not expose it.
type VideoAssetResponse struct {
	Path     string   `json:"path"`
	StartSec *float64 `json:"startSec,omitempty"`
	EndSec   *float64 `json:"endSec,omitempty"`
}

type MeetingDeleteResponse struct {
	DeletedID       string  `json:"deletedId"`
	ArtifactWarning *string `json:"artifactWarning,omitempty"`
}

type CompactVideoResponse struct {
	Attempted  bool  `json:"attempted"`
	SavedBytes int64 `json:"savedBytes"`
}

type RecoverStaleRecordingsResponse struct {
	Recovered int `json:"recovered"`
}

type ProcessingPendingResponse struct {
	Capabilities []meetingprocessing.Capability `json:"capabilities"`
}

type ProcessingDrainResponse struct {
	Capability meetingprocessing.Capability `json:"capability"`
	Attempted  int                          `json:"attempted"`
	Completed  int                          `json:"completed"`
	Requeued   int                          `json:"requeued"`
	Failed     int                          `json:"failed"`
}

type MeetingStatus struct {
	State      meetinglifecycle.MeetingState `json:"state"`
	UpdatedAt  string                        `json:"updatedAt"`
	Capture    CaptureStatusInfo             `json:"capture"`
	Video      VideoStatusInfo               `json:"video"`
	Processing ProcessingStatusInfo          `json:"processing"`
}

type CaptureStatusInfo struct {
	State          db.CaptureStatus `json:"state"`
	UpdatedAt      string           `json:"updatedAt"`
	FailureMessage *string          `json:"failureMessage,omitempty"`
}

type ProcessingStatusInfo struct {
	State          db.ProcessingStatus `json:"state"`
	UpdatedAt      string              `json:"updatedAt"`
	FailureMessage *string             `json:"failureMessage,omitempty"`
}

type VideoStatusInfo struct {
	State              db.VideoState `json:"state"`
	SourceType         *string       `json:"sourceType,omitempty"`
	StartSec           *float64      `json:"startSec,omitempty"`
	EndSec             *float64      `json:"endSec,omitempty"`
	Message            *string       `json:"message,omitempty"`
	MicStartHostSec    *float64      `json:"micStartHostSec,omitempty"`
	SystemStartHostSec *float64      `json:"systemStartHostSec,omitempty"`
	VideoStartHostSec  *float64      `json:"videoStartHostSec,omitempty"`
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
	mu  sync.Mutex
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
	e.mu.Lock()
	defer e.mu.Unlock()
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
	status := meetinglifecycle.ViewFor(meeting)
	return MeetingStatus{State: status.State, UpdatedAt: status.UpdatedAt, Capture: CaptureStatusInfoFor(meeting), Video: VideoStatusInfo{
		State: meeting.VideoState, SourceType: meeting.VideoSourceType, StartSec: meeting.VideoStartSec,
		EndSec: meeting.VideoEndSec, Message: meeting.VideoMessage, MicStartHostSec: meeting.MicStartHostSec,
		SystemStartHostSec: meeting.SystemStartHostSec, VideoStartHostSec: meeting.VideoOriginHostSec,
	}, Processing: ProcessingStatusInfoFor(meeting)}
}

func CaptureStatusInfoFor(meeting db.Meeting) CaptureStatusInfo {
	return CaptureStatusInfo{State: meeting.CaptureStatus, UpdatedAt: meeting.CaptureStatusUpdatedAt, FailureMessage: meeting.CaptureFailureMessage}
}

func ProcessingStatusInfoFor(meeting db.Meeting) ProcessingStatusInfo {
	return ProcessingStatusInfo{State: meeting.ProcessingStatus, UpdatedAt: meeting.ProcessingStatusUpdatedAt, FailureMessage: meeting.ProcessingFailureMessage}
}
