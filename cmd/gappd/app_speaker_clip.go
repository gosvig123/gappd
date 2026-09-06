package main

import (
	"encoding/base64"
	"fmt"
	"path/filepath"
	"sort"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/spf13/cobra"
)

const speakerClipSeconds = 8.0

func appSpeakerClipCmd() *cobra.Command {
	var key string
	var index int
	cmd := meetingJSONCommand("speaker-clip [meeting-id]", cobra.ExactArgs(1), func(args []string) error {
		return runSpeakerClip(args[0], key, index)
	})
	cmd.Flags().StringVar(&key, "speaker-key", "", "Original speaker key")
	cmd.Flags().IntVar(&index, "index", 0, "Alternate clip index")
	return cmd
}

func runSpeakerClip(id, key string, index int) error {
	_, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	meeting, segments, err := loadMeetingDetail(store, id)
	if err != nil {
		return err
	}
	clip, err := selectSpeakerClip(segments, key, index)
	if err != nil {
		return err
	}
	return writeSpeakerClip(meeting, clip)
}

func writeSpeakerClip(meeting *db.Meeting, clip db.Segment) error {
	path, err := speakerAudioPath(meeting, clip)
	if err != nil {
		return err
	}
	data, err := readSpeakerWAV(path, clip.Start, min(clip.End-clip.Start, speakerClipSeconds))
	if err != nil {
		return fmt.Errorf("play speaker %q: %w; choose another clip or restore retained audio", clip.RawSpeaker(), err)
	}
	return writeJSON(appprotocol.SpeakerClipResponse{AudioBase64: base64.StdEncoding.EncodeToString(data), MimeType: "audio/wav", Text: clip.Text, StartSec: clip.Start})
}

func selectSpeakerClip(segments []db.Segment, key string, index int) (db.Segment, error) {
	clips := make([]db.Segment, 0)
	for _, segment := range segments {
		if segment.RawSpeaker() == key && segment.End-segment.Start >= 0.25 && !clipOverlaps(segment, segments) {
			clips = append(clips, segment)
		}
	}
	if len(clips) == 0 || index < 0 {
		return db.Segment{}, fmt.Errorf("play speaker %q: no clear audio clip available", key)
	}
	sort.SliceStable(clips, func(i, j int) bool { return clipQuality(clips[i]) > clipQuality(clips[j]) })
	return clips[index%len(clips)], nil
}

func clipQuality(segment db.Segment) float64 {
	confidence := 1.0
	if segment.SpeakerConfidence != nil {
		confidence = *segment.SpeakerConfidence
	}
	return min(segment.End-segment.Start, speakerClipSeconds) * confidence
}

func clipOverlaps(clip db.Segment, segments []db.Segment) bool {
	for _, other := range segments {
		if other.RawSpeaker() != clip.RawSpeaker() && other.Start < min(clip.End, clip.Start+speakerClipSeconds) && other.End > clip.Start {
			return true
		}
	}
	return false
}

func speakerAudioPath(meeting *db.Meeting, segment db.Segment) (string, error) {
	if meeting.AudioPath == nil || *meeting.AudioPath == "" {
		return "", fmt.Errorf("play speaker: retained audio is unavailable")
	}
	filename := audioartifact.SystemFilename
	if segment.RawSpeaker() == db.SpeakerYou || segment.SpeakerSource != nil && *segment.SpeakerSource == db.SegmentSourceMicrophone {
		filename = audioartifact.MicFilename
	}
	return filepath.Join(*meeting.AudioPath, filename), nil
}
