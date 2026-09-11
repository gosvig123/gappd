package meetingprocessing

import (
	"context"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/diarize"
	"testing"
)

func TestDiarizationQueuePersistsLocalVoiceEvidence(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createCapturedMeeting(t, store)
	system := db.SegmentSourceSystem
	if _, err := store.Conn.Exec(`UPDATE meetings SET transcript='words',audio_path='test',diarization_state='pending' WHERE id=?`, meeting.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertSegment(&db.Segment{ID: "remote", MeetingID: meeting.ID, Start: 0, End: 20, Text: "words", Speaker: "Other", SpeakerSource: &system}); err != nil {
		t.Fatal(err)
	}
	runner := func(context.Context, string) ([]diarize.WindowReport, error) { return cleanVoiceWindows(), nil }
	result, err := (Service{Store: store, RunDiarization: runner}).Drain(context.Background(), CapabilityDiarization)
	if err != nil || result.Completed != 1 {
		t.Fatalf("drain: %+v %v", result, err)
	}
	var model, source string
	if err := store.Conn.QueryRow(`SELECT model,source FROM meeting_speaker_embeddings WHERE meeting_id=?`, meeting.ID).Scan(&model, &source); err != nil {
		t.Fatal(err)
	}
	if model != db.VoiceModel || source == "" {
		t.Fatal("lost voice provenance")
	}
}

func cleanVoiceWindows() []diarize.WindowReport {
	vector := make([]float64, db.SpeakerEmbeddingDimension)
	vector[0] = 1
	return []diarize.WindowReport{{DurationSeconds: 20, Clusters: []diarize.LocalCluster{{ID: "remote", Centroid: vector}},
		Spans: []diarize.LocalSpan{{ClusterID: "remote", StartSeconds: 0, EndSeconds: 20, Quality: 1, Identity: 1}}}}
}
