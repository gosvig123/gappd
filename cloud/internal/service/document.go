package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

// Version-1 Meeting document bounds. MaxTranscriptBytes is the real-Meeting limit;
// migration 004 must raise the cloud transcript column cap to match it.
const (
	DocumentVersion    = 1
	MaxDocumentBytes   = 2 << 20
	MaxTranscriptBytes = 1 << 20
	MaxTitleBytes      = 512
	MaxSummaryBytes    = 64 << 10
	MaxLanguageBytes   = 32
	MaxSpeakerBytes    = 128
	MaxTurnBytes       = 4096
	MaxRevision        = 1 << 31
	MaxSpeakers        = 32
	MaxTurns           = 5000
	MaxMeetingSeconds  = 24 * 60 * 60
)

var errDocument = errors.New("invalid document")

// DocumentSpeaker is one Meeting speaker label. Person identity stays local.
type DocumentSpeaker struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// DocumentTurn is one transcript turn, offset in seconds from the Meeting start.
type DocumentTurn struct {
	StartSec   float64 `json:"start_sec"`
	EndSec     float64 `json:"end_sec"`
	SpeakerKey string  `json:"speaker_key"`
	Text       string  `json:"text"`
}

// MeetingDocument is the complete uploaded text of one Meeting. It carries no audio,
// no Person identity, no voice evidence, no local path and no Saved Agenda draft.
type MeetingDocument struct {
	Version   int               `json:"version"`
	MeetingID string            `json:"meeting_id"`
	Revision  int               `json:"revision"`
	Title     string            `json:"title"`
	StartedAt string            `json:"started_at"`
	EndedAt   string            `json:"ended_at,omitempty"`
	Language  string            `json:"language,omitempty"`
	Summary   string            `json:"summary"`
	Speakers  []DocumentSpeaker `json:"speakers"`
	Turns     []DocumentTurn    `json:"turns"`
}

// ParseMeetingDocument accepts only the exact version-1 document. Unknown fields are
// rejected, so a caller cannot smuggle extra local data into the cloud.
func ParseMeetingDocument(data []byte) (MeetingDocument, error) {
	var document MeetingDocument
	if len(data) == 0 || len(data) > MaxDocumentBytes {
		return document, errDocument
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return MeetingDocument{}, errDocument
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return MeetingDocument{}, errDocument
	}
	if err := document.validate(); err != nil {
		return MeetingDocument{}, err
	}
	return document, nil
}

func (d MeetingDocument) validate() error {
	if err := d.validateEnvelope(); err != nil {
		return err
	}
	if err := d.validateTimes(); err != nil {
		return err
	}
	keys, err := d.speakerKeys()
	if err != nil {
		return err
	}
	if err := d.validateTurns(keys); err != nil {
		return err
	}
	// The bounded text is the flattened transcript, not the sum of turn texts.
	if len(d.Transcript()) > MaxTranscriptBytes {
		return errDocument
	}
	return nil
}

func (d MeetingDocument) validateEnvelope() error {
	if d.Version != DocumentVersion || d.Revision < 1 || d.Revision > MaxRevision {
		return errDocument
	}
	if !meetingID.MatchString(d.MeetingID) {
		return errDocument
	}
	if len(d.Title) == 0 || len(d.Title) > MaxTitleBytes || len(d.Summary) > MaxSummaryBytes {
		return errDocument
	}
	if len(d.Language) > MaxLanguageBytes {
		return errDocument
	}
	return nil
}

func (d MeetingDocument) validateTimes() error {
	started, err := time.Parse(time.RFC3339, d.StartedAt)
	if err != nil {
		return errDocument
	}
	if d.EndedAt == "" {
		return nil
	}
	ended, err := time.Parse(time.RFC3339, d.EndedAt)
	if err != nil || ended.Before(started) {
		return errDocument
	}
	return nil
}

// speakerKeys returns key to label. A transcript-free Meeting may have no speakers.
func (d MeetingDocument) speakerKeys() (map[string]string, error) {
	if len(d.Speakers) > MaxSpeakers {
		return nil, errDocument
	}
	keys := make(map[string]string, len(d.Speakers))
	for _, speaker := range d.Speakers {
		if speaker.Key == "" || len(speaker.Key) > MaxSpeakerBytes || len(speaker.Label) > MaxSpeakerBytes {
			return nil, errDocument
		}
		if _, exists := keys[speaker.Key]; exists {
			return nil, errDocument
		}
		keys[speaker.Key] = speaker.Label
	}
	return keys, nil
}

// Turns must be ordered by start time and bounded. Overlap preserves simultaneous speech.
func (d MeetingDocument) validateTurns(keys map[string]string) error {
	if len(d.Turns) > MaxTurns {
		return errDocument
	}
	previousStart := 0.0
	for _, turn := range d.Turns {
		if turn.StartSec < previousStart || turn.EndSec < turn.StartSec || turn.EndSec > MaxMeetingSeconds {
			return errDocument
		}
		if _, ok := keys[turn.SpeakerKey]; !ok || len(turn.Text) > MaxTurnBytes {
			return errDocument
		}
		previousStart = turn.StartSec
	}
	return nil
}

// Transcript flattens the turns into the searchable text projection.
func (d MeetingDocument) Transcript() string {
	labels := make(map[string]string, len(d.Speakers))
	for _, speaker := range d.Speakers {
		labels[speaker.Key] = speaker.Label
	}
	var builder strings.Builder
	for _, turn := range d.Turns {
		seconds := int(turn.StartSec)
		label := labels[turn.SpeakerKey]
		if label == "" {
			label = turn.SpeakerKey
		}
		fmt.Fprintf(&builder, "[%d:%02d] %s: %s\n", seconds/60, seconds%60, label, turn.Text)
	}
	return strings.TrimSuffix(builder.String(), "\n")
}
