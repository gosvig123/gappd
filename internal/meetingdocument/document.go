// Package meetingdocument builds the version-1 cloud Meeting document from local storage.
// It is local only: it never talks to the network and never mutates a Meeting.
package meetingdocument

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

// Bounds mirror docs/cloud-meeting-document.md. The cloud re-validates every field, so a
// mismatch here can only refuse an upload, never widen what the cloud accepts.
const (
	Version           = 1
	MaxDocumentBytes  = 2 << 20
	MaxTitleBytes     = 512
	MaxSummaryBytes   = 64 << 10
	MaxLanguageBytes  = 32
	MaxSpeakerBytes   = 128
	MaxTurnBytes      = 4096
	MaxSpeakers       = 32
	MaxTurns          = 5000
	MaxMeetingSeconds = 24 * 60 * 60
)

type Speaker struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

type Turn struct {
	StartSec   float64 `json:"start_sec"`
	EndSec     float64 `json:"end_sec"`
	SpeakerKey string  `json:"speaker_key"`
	Text       string  `json:"text"`
}

// Document is the complete uploaded text of one Meeting. Audio, Person identity, voice
// evidence, local paths, credentials, Calendar caches and Agenda drafts stay local.
type Document struct {
	Version   int       `json:"version"`
	MeetingID string    `json:"meeting_id"`
	Revision  int       `json:"revision"`
	Title     string    `json:"title"`
	StartedAt string    `json:"started_at"`
	EndedAt   string    `json:"ended_at,omitempty"`
	Language  string    `json:"language,omitempty"`
	Summary   string    `json:"summary"`
	Speakers  []Speaker `json:"speakers"`
	Turns     []Turn    `json:"turns"`
}

// Build returns the document for one local Meeting at the given sync revision. The revision
// comes from the sync queue, not from a local counter or the clock.
func Build(meeting *db.Meeting, segments []db.Segment, revision int) ([]byte, error) {
	if meeting == nil || revision < 1 || meeting.ID == "" {
		return nil, errors.New("Meeting document unavailable")
	}
	document := Document{
		Version: Version, MeetingID: meeting.ID, Revision: revision, Title: meeting.Title,
		StartedAt: meeting.StartedAt, EndedAt: value(meeting.EndedAt), Language: meeting.Language,
		Summary: value(meeting.Summary), Speakers: []Speaker{}, Turns: []Turn{},
	}
	if err := document.addTurns(segments); err != nil {
		return nil, err
	}
	if err := document.validate(); err != nil {
		return nil, err
	}
	data, err := json.Marshal(document)
	if err != nil || len(data) > MaxDocumentBytes {
		return nil, errors.New("Meeting document unavailable")
	}
	return data, nil
}

// addTurns folds the recorded segments into ordered turns and their speaker labels.
func (d *Document) addTurns(segments []db.Segment) error {
	seen := map[string]bool{}
	for _, segment := range segments {
		if len(segment.Text) == 0 {
			continue
		}
		if len(segment.Text) > MaxTurnBytes {
			return errors.New("Meeting document unavailable")
		}
		key := segment.SpeakerKey
		if key == "" {
			key = segment.Speaker
		}
		if key == "" || len(key) > MaxSpeakerBytes {
			return errors.New("Meeting document unavailable")
		}
		if !seen[key] {
			if len(d.Speakers) >= MaxSpeakers {
				return errors.New("Meeting document unavailable")
			}
			seen[key] = true
			d.Speakers = append(d.Speakers, Speaker{Key: key, Label: segment.Speaker})
		}
		d.Turns = append(d.Turns, Turn{StartSec: segment.Start, EndSec: segment.End, SpeakerKey: key, Text: segment.Text})
	}
	return nil
}

func (d Document) validate() error {
	if err := d.validateEnvelope(); err != nil {
		return err
	}
	return d.validateTurns()
}

func (d Document) validateEnvelope() error {
	if d.Version != Version || d.Revision < 1 || d.MeetingID == "" {
		return errors.New("Meeting document unavailable")
	}
	if len(d.Title) == 0 || len(d.Title) > MaxTitleBytes || len(d.Summary) > MaxSummaryBytes || len(d.Language) > MaxLanguageBytes {
		return errors.New("Meeting document unavailable")
	}
	started, err := time.Parse(time.RFC3339, d.StartedAt)
	if err != nil {
		return errors.New("Meeting document unavailable")
	}
	if d.EndedAt == "" {
		return nil
	}
	ended, err := time.Parse(time.RFC3339, d.EndedAt)
	if err != nil || ended.Before(started) {
		return errors.New("Meeting document unavailable")
	}
	return nil
}

func (d Document) validateTurns() error {
	if len(d.Turns) > MaxTurns {
		return errors.New("Meeting document unavailable")
	}
	previousStart := 0.0
	for _, turn := range d.Turns {
		if turn.StartSec < previousStart || turn.EndSec < turn.StartSec || turn.EndSec > MaxMeetingSeconds {
			return errors.New("Meeting document unavailable")
		}
		if strings.TrimSpace(turn.Text) == "" {
			return errors.New("Meeting document unavailable")
		}
		previousStart = turn.StartSec
	}
	return nil
}

func value(optional *string) string {
	if optional == nil {
		return ""
	}
	return *optional
}
