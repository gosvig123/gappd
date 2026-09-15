package db

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestClearYouDoesNotSuppressRemoteRecognition(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	voiceMeeting(t, store, "source")
	voiceMeeting(t, store, "target")
	assignVoice(t, store, "source", Person{Name: "Alice", Email: "alice@example.test"})
	mustExec(t, store, `INSERT INTO segments(id,meeting_id,start_sec,end_sec,text,speaker,speaker_source) VALUES('mic','target',21,22,'me','You','microphone')`)
	if err := store.AssignSpeaker("target", "You", Person{}); err != nil {
		t.Fatal(err)
	}
	recognizeVoice(t, store, "target", []string{"alice@example.test"}, true)
	segments, err := store.GetSegments("target")
	if err != nil || segments[0].Speaker != "Alice" {
		t.Fatalf("remote identity lost: %+v %v", segments, err)
	}
}

func TestProjectionEvidenceUsesCommittedRevision(t *testing.T) {
	store, id := projectionFixture(t)
	input := projectionInput(id)
	input.Embeddings = []SpeakerEmbedding{{Key: "Speaker 1", Vector: voiceVector(0), Model: VoiceModel, Source: "system/test", Seconds: 20, Quality: 1}}
	meeting, applied, err := store.CommitSpeakerProjection(context.Background(), input)
	if err != nil || !applied {
		t.Fatalf("projection: %v %v", applied, err)
	}
	var source string
	if err := store.Conn.QueryRow(`SELECT source FROM meeting_speaker_embeddings WHERE meeting_id=?`, id).Scan(&source); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(source, fmt.Sprintf("/revision:%d", meeting.TranscriptRevision)) {
		t.Fatalf("source %q does not match revision %d", source, meeting.TranscriptRevision)
	}
}
