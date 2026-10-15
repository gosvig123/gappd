package db

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/meetinglang"
)

type VideoState string
type CaptureStatus string
type ProcessingStatus string
type DiarizationState string

const (
	VideoStateOff        VideoState = "off"
	VideoStateSelecting  VideoState = "selecting"
	VideoStateCancelled  VideoState = "cancelled"
	VideoStateSkipped    VideoState = "skipped"
	VideoStateRecording  VideoState = "recording"
	VideoStateEnded      VideoState = "ended"
	VideoStateReady      VideoState = "ready"
	VideoStateFailed     VideoState = "failed"
	VideoStateUnfinished VideoState = "unfinished"

	CaptureStatusRecording CaptureStatus = "recording"
	CaptureStatusCaptured  CaptureStatus = "captured"
	CaptureStatusFailed    CaptureStatus = "failed"

	ProcessingStatusPending ProcessingStatus = "pending"
	// ProcessingStatusNotStarted is retained as a source-compatible alias.
	ProcessingStatusNotStarted ProcessingStatus = ProcessingStatusPending
	ProcessingStatusProcessing ProcessingStatus = "processing"
	ProcessingStatusCompleted  ProcessingStatus = "completed"
	ProcessingStatusFailed     ProcessingStatus = "failed"

	DiarizationStateNotRequested  DiarizationState = "not_requested"
	DiarizationStateNotApplicable DiarizationState = "not_applicable"
	DiarizationStatePending       DiarizationState = "pending"
	DiarizationStateProcessing    DiarizationState = "processing"
	DiarizationStateCompleted     DiarizationState = "completed"
	DiarizationStateDegraded      DiarizationState = "degraded"
)

var (
	AllVideoStates        = []VideoState{VideoStateOff, VideoStateSelecting, VideoStateCancelled, VideoStateSkipped, VideoStateRecording, VideoStateEnded, VideoStateReady, VideoStateFailed, VideoStateUnfinished}
	AllCaptureStatuses    = []CaptureStatus{CaptureStatusRecording, CaptureStatusCaptured, CaptureStatusFailed}
	AllProcessingStatuses = []ProcessingStatus{ProcessingStatusPending, ProcessingStatusProcessing, ProcessingStatusCompleted, ProcessingStatusFailed}
	AllDiarizationStates  = []DiarizationState{DiarizationStateNotRequested, DiarizationStateNotApplicable, DiarizationStatePending, DiarizationStateProcessing, DiarizationStateCompleted, DiarizationStateDegraded}
)

type Meeting struct {
	ID                        string
	Title                     string
	StartedAt                 string
	EndedAt                   *string
	CaptureStatus             CaptureStatus
	CaptureStatusUpdatedAt    string
	CaptureFailureMessage     *string
	ProcessingStatus          ProcessingStatus
	ProcessingStatusUpdatedAt string
	ProcessingFailureMessage  *string
	ProcessingClaimToken      *string
	ProcessingClaimExpiresAt  *string
	VideoState                VideoState
	VideoSourceType           *string
	VideoFile                 *string
	VideoStartSec             *float64
	VideoEndSec               *float64
	VideoMessage              *string
	VideoOriginHostSec        *float64
	VideoEndHostSec           *float64
	MicStartHostSec           *float64
	SystemStartHostSec        *float64
	AudioPath                 *string
	Transcript                *string
	TranscriptRevision        int
	Summary                   *string
	SummaryTranscriptRevision int
	ExtractionJSON            *string
	DiarizationState          DiarizationState
	DiarizationError          *string
	DiarizationJSON           *string
	Language                  string
	Tags                      string
	Source                    string
	CreatedAt                 string
}

type MeetingListEntry struct {
	Meeting
	HasTranscript bool
	HasSummary    bool
}

const selectMeetingsSQL = `SELECT id, title, started_at, ended_at, capture_status, capture_status_updated_at, capture_failure_message,
	processing_status, processing_status_updated_at, processing_failure_message,
	processing_claim_token, processing_claim_expires_at, audio_path,
	transcript, transcript_revision, summary, summary_transcript_revision, extraction_json,
	diarization_state, diarization_error, diarization_json, language, tags, source, created_at, video_state, video_source_type, video_file, video_start_sec, video_end_sec, video_message, video_origin_host_sec, video_end_host_sec, mic_start_host_sec, system_start_host_sec
	FROM meetings`

const selectMeetingListEntriesSQL = `SELECT id, title, started_at, ended_at, capture_status, capture_status_updated_at, capture_failure_message,
	processing_status, processing_status_updated_at, processing_failure_message,
	processing_claim_token, processing_claim_expires_at, audio_path,
	transcript IS NOT NULL AND trim(transcript)<>'', transcript_revision,
	summary IS NOT NULL AND trim(summary)<>'', summary_transcript_revision, extraction_json,
	diarization_state, diarization_error, diarization_json, language, tags, source, created_at, video_state, video_source_type, video_file, video_start_sec, video_end_sec, video_message, video_origin_host_sec, video_end_host_sec, mic_start_host_sec, system_start_host_sec
	FROM meetings`

func (d *DB) CreateMeeting(m *Meeting) error {
	m.Language = meetinglang.Normalize(m.Language)
	if m.DiarizationState == "" {
		m.DiarizationState = DiarizationStateNotRequested
	}
	if m.ID == "" {
		id, err := newID()
		if err != nil {
			return err
		}
		m.ID = id
	}
	if _, err := d.Conn.Exec(insertMeetingSQL, meetingInsertArgs(m)...); err != nil {
		return fmt.Errorf("create meeting: %w", err)
	}
	return nil
}

const insertMeetingSQL = `INSERT INTO meetings (id,title,started_at,ended_at,capture_status,capture_status_updated_at,
	capture_failure_message,processing_status,processing_status_updated_at,processing_failure_message,
	processing_claim_token,processing_claim_expires_at,audio_path,transcript,transcript_revision,summary,summary_transcript_revision,
	extraction_json,diarization_state,diarization_error,diarization_json,language,tags,source)
	VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

func meetingInsertArgs(m *Meeting) []any {
	return []any{m.ID, m.Title, m.StartedAt, m.EndedAt, m.CaptureStatus, m.CaptureStatusUpdatedAt, m.CaptureFailureMessage,
		m.ProcessingStatus, m.ProcessingStatusUpdatedAt, m.ProcessingFailureMessage, m.ProcessingClaimToken,
		m.ProcessingClaimExpiresAt, m.AudioPath, m.Transcript, m.TranscriptRevision, m.Summary, m.SummaryTranscriptRevision,
		m.ExtractionJSON, m.DiarizationState, m.DiarizationError, m.DiarizationJSON, m.Language, m.Tags, m.Source}
}

func (d *DB) GetMeeting(id string) (*Meeting, error) {
	m, err := scanMeetingRow(d.Conn.QueryRow(selectMeetingsSQL+` WHERE id=?`, id))
	if err != nil {
		return nil, fmt.Errorf("get meeting: %w", err)
	}
	return &m, nil
}

func (d *DB) ListMeetings(limit int) ([]Meeting, error) {
	rows, err := d.Conn.Query(selectMeetingsSQL+` ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list meetings: %w", err)
	}
	defer rows.Close()
	return scanMeetings(rows)
}

func (d *DB) ListMeetingEntries(limit int) ([]MeetingListEntry, error) {
	rows, err := d.Conn.Query(selectMeetingListEntriesSQL+` ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list meeting entries: %w", err)
	}
	defer rows.Close()
	return scanMeetingListEntries(rows)
}

func (d *DB) ListStaleRecordingMeetings(cutoff string, limit int) ([]Meeting, error) {
	rows, err := d.Conn.Query(selectMeetingsSQL+` WHERE capture_status = ? AND capture_status_updated_at < ? ORDER BY started_at ASC LIMIT ?`, CaptureStatusRecording, cutoff, limit)
	if err != nil {
		return nil, fmt.Errorf("list stale recording meetings: %w", err)
	}
	defer rows.Close()
	return scanMeetings(rows)
}
