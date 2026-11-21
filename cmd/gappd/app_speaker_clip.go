package main

import (
	"encoding/base64"
	"fmt"
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
	if index < 0 {
		return db.Segment{}, fmt.Errorf("play speaker %q: no clear audio clip available", key)
	}
	clean := make([]db.Segment, 0)
	fallback := make([]db.Segment, 0)
	for _, segment := range segments {
		if segment.RawSpeaker() != key || segment.End <= segment.Start {
			continue
		}
		fallback = append(fallback, segment)
		if segment.End-segment.Start >= 0.25 && !clipOverlaps(segment, segments) {
			clean = append(clean, segment)
		}
	}
	if len(clean) > 0 {
		sort.SliceStable(clean, func(i, j int) bool { return clipQuality(clean[i]) > clipQuality(clean[j]) })
		return clean[index%len(clean)], nil
	}
	if len(fallback) == 0 {
		return db.Segment{}, fmt.Errorf("play speaker %q: no clear audio clip available", key)
	}
	type fallbackCandidate struct {
		segment db.Segment
		usable  bool
		overlap float64
		quality float64
	}
	ranked := make([]fallbackCandidate, len(fallback))
	for i, seg := range fallback {
		ranked[i] = fallbackCandidate{
			segment: seg,
			usable:  seg.End-seg.Start >= 0.25,
			overlap: clipOverlapRatio(seg, segments),
			quality: clipQuality(seg),
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].usable != ranked[j].usable {
			return ranked[i].usable
		}
		if ranked[i].overlap != ranked[j].overlap {
			return ranked[i].overlap < ranked[j].overlap
		}
		return ranked[i].quality > ranked[j].quality
	})
	return ranked[index%len(ranked)].segment, nil
}

func clipQuality(segment db.Segment) float64 {
	confidence := 1.0
	if segment.SpeakerConfidence != nil {
		confidence = *segment.SpeakerConfidence
	}
	return min(segment.End-segment.Start, speakerClipSeconds) * confidence
}

// clipOverlaps checks only segments on the same audio stream (mic vs system),
// because mic and system audio are stored in separate mono files.
func clipOverlaps(clip db.Segment, segments []db.Segment) bool {
	stream := segmentAudioStream(clip)
	clipEnd := min(clip.End, clip.Start+speakerClipSeconds)
	for _, other := range segments {
		if other.RawSpeaker() != clip.RawSpeaker() && segmentAudioStream(other) == stream && other.Start < clipEnd && other.End > clip.Start {
			return true
		}
	}
	return false
}

func clipOverlapRatio(clip db.Segment, segments []db.Segment) float64 {
	stream := segmentAudioStream(clip)
	clipEnd := min(clip.End, clip.Start+speakerClipSeconds)
	duration := clipEnd - clip.Start
	if duration <= 0 {
		return 1
	}
	type span struct{ start, end float64 }
	var spans []span
	for _, other := range segments {
		if other.RawSpeaker() == clip.RawSpeaker() || segmentAudioStream(other) != stream {
			continue
		}
		start := max(clip.Start, other.Start)
		end := min(clipEnd, other.End)
		if end > start {
			spans = append(spans, span{start: start, end: end})
		}
	}
	if len(spans) == 0 {
		return 0
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].start < spans[j].start })
	mergedStart, mergedEnd := spans[0].start, spans[0].end
	var overlapped float64
	for _, next := range spans[1:] {
		if next.start <= mergedEnd {
			mergedEnd = max(mergedEnd, next.end)
			continue
		}
		overlapped += mergedEnd - mergedStart
		mergedStart, mergedEnd = next.start, next.end
	}
	overlapped += mergedEnd - mergedStart
	return min(overlapped/duration, 1)
}

func segmentAudioStream(segment db.Segment) string {
	if segment.RawSpeaker() == db.SpeakerYou || segment.SpeakerSource != nil && *segment.SpeakerSource == db.SegmentSourceMicrophone {
		return "mic"
	}
	return "system"
}

func speakerAudioPath(meeting *db.Meeting, segment db.Segment) (string, error) {
	if meeting.AudioPath == nil || *meeting.AudioPath == "" {
		return "", fmt.Errorf("play speaker: retained audio is unavailable")
	}
	artifacts := audioartifact.New(*meeting.AudioPath)
	if segmentAudioStream(segment) == "mic" {
		return artifacts.MicPath(), nil
	}
	return artifacts.SystemPath(), nil
}
