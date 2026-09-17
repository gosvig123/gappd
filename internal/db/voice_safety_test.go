package db

import (
	"database/sql"
	"fmt"
	"math"
	"path/filepath"
	"testing"
)

func TestVoiceInvalidVectorRejections(t *testing.T) {
	invalid := [][]float64{nil, {1, 0}, make([]float64, SpeakerEmbeddingDimension)}
	nan, inf := voiceVector(0), voiceVector(0)
	nan[1], inf[1] = math.NaN(), math.Inf(1)
	invalid = append(invalid, nan, inf)
	for _, vector := range invalid {
		if _, err := encodeCentroid(vector); err == nil {
			t.Fatal("accepted invalid vector")
		}
	}
}

func TestVoiceAmbiguousMatchRejections(t *testing.T) {
	profiles := []voiceProfile{{PersonID: "a", Vector: voiceVector(0)}}
	samples := []SpeakerEmbedding{{Key: "Speaker 1", Vector: voiceVector(1)}}
	if len(matchProfiles(samples, profiles)) != 0 {
		t.Fatal("accepted unknown voice")
	}
	samples[0].Vector = voiceVector(0)
	profiles = append(profiles, voiceProfile{PersonID: "b", Vector: voiceVector(0)})
	if len(matchProfiles(samples, profiles)) != 0 {
		t.Fatal("accepted person tie")
	}
	profiles = profiles[:1]
	samples = append(samples, SpeakerEmbedding{Key: "Speaker 2", Vector: voiceVector(0)})
	if len(matchProfiles(samples, profiles)) != 0 {
		t.Fatal("accepted competing cluster tie")
	}
}

func TestVoiceQualityVersionAndGenericRejections(t *testing.T) {
	store := openTestDB(t)
	voiceMeeting(t, store, "source")
	for _, e := range rejectedVoiceEvidence() {
		tx, err := store.Conn.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err := replaceSpeakerEmbeddings(tx, "source", []SpeakerEmbedding{e}); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		voiceCount(t, store, "meeting_speaker_embeddings", 0)
	}
}

func TestVoiceCandidatesUseExactCalendarOrConfirmedRemoteGroup(t *testing.T) {
	store := openTestDB(t)
	voiceMeeting(t, store, "past")
	voiceMeeting(t, store, "current")
	assignVoice(t, store, "past", Person{Name: "Alice", Email: "alice@example.test"})
	assignVoice(t, store, "current", Person{Name: "Alice", Email: "alice@example.test"})
	mustExec(t, store, `INSERT INTO people(id,name,email) VALUES('bob','Bob','bob@example.test')`)
	mustExec(t, store, `INSERT INTO meeting_speakers VALUES('past','Speaker 2','bob')`)
	tx, err := store.Conn.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	assertCandidates(t, tx, []string{"ALICE@example.test"}, true, 1)
	assertCandidates(t, tx, nil, false, 2)
	if err := setIdentityOrigin(tx, "past", "Speaker 2", "automatic"); err != nil {
		t.Fatal(err)
	}
	assertCandidates(t, tx, nil, false, 1)
	if _, err := tx.Exec(`DELETE FROM meeting_speakers WHERE meeting_id='current'; INSERT INTO meeting_speakers SELECT 'current','You',id FROM people WHERE email='alice@example.test'`); err != nil {
		t.Fatal(err)
	}
	assertCandidates(t, tx, nil, false, 0)
}

func TestVoiceSchemaUpgradeAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	mustExec(t, store, `DROP TABLE voice_samples; DROP TABLE meeting_speaker_embeddings;
 CREATE TABLE meeting_speaker_embeddings(meeting_id TEXT,speaker_key TEXT,centroid TEXT);
 INSERT INTO meeting_speaker_embeddings VALUES('old','Speaker 1','[1,0]');
 CREATE TABLE person_voice_profiles(person_id TEXT,centroid TEXT)`)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		checkVoiceReopen(t, path)
	}
}

func TestRecognitionRejectsStaleRevisionAndActiveClaim(t *testing.T) {
	store := openTestDB(t)
	voiceMeeting(t, store, "source")
	if err := store.RecognizeSpeakers("source", -1, nil, true); err == nil {
		t.Fatal("accepted stale revision")
	}
	mustExec(t, store, `UPDATE meetings SET processing_status='processing',processing_claim_token='active',processing_claim_expires_at='2099-01-01T00:00:00Z' WHERE id='source'`)
	if err := store.RecognizeSpeakers("source", 0, nil, true); err == nil {
		t.Fatal("accepted active claim")
	}
	var token string
	if err := store.Conn.QueryRow(`SELECT processing_claim_token FROM meetings WHERE id='source'`).Scan(&token); err != nil || token != "active" {
		t.Fatal("lost active claim")
	}
}

func TestVoiceTargetsIncludeOlderMeetingsWithBoundedPages(t *testing.T) {
	store := openTestDB(t)
	for i := 0; i < 105; i++ {
		voiceMeeting(t, store, fmt.Sprintf("meeting-%03d", i))
	}
	page, err := store.VoiceTargets("")
	if err != nil || len(page) != 100 {
		t.Fatalf("first page: %d %v", len(page), err)
	}
	page, err = store.VoiceTargets(page[len(page)-1].ID)
	if err != nil || len(page) != 5 {
		t.Fatalf("second page: %d %v", len(page), err)
	}
}

func rejectedVoiceEvidence() []SpeakerEmbedding {
	base := SpeakerEmbedding{Key: "Speaker 1", Vector: voiceVector(0), Model: VoiceModel, Source: "test", Seconds: 20, Quality: 1}
	tests := []SpeakerEmbedding{base, base, base, base, base, base, base}
	tests[0].Model = "other-version"
	tests[1].Seconds = 2
	tests[2].Quality = .7
	tests[3].Vector = []float64{1, 0}
	tests[4].Key = SpeakerOther
	tests[5].Key = SpeakerYou
	tests[6].Quality = math.NaN()
	return tests
}

func assertCandidates(t *testing.T, tx *sql.Tx, emails []string, calendar bool, want int) {
	t.Helper()
	ids, err := candidatePeople(tx, "current", emails, calendar)
	if err != nil || len(ids) != want {
		t.Fatalf("candidate count %d want %d: %v", len(ids), want, err)
	}
}

func checkVoiceReopen(t *testing.T, path string) {
	t.Helper()
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	voiceCount(t, store, "meeting_speaker_embeddings", 0)
	voiceCount(t, store, "voice_samples", 0)
}
