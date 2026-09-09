package db

import "testing"

func TestAgendaHistoryUsesSavedPersonEmailsOnly(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := lifecycleRoundTripMeeting()
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Conn.Exec(`INSERT INTO people(id,name,email) VALUES ('person','Invented Name','saved@example.com')`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Conn.Exec(`INSERT INTO meeting_speakers(meeting_id,speaker_key,person_id) VALUES (?,'Speaker 1','person')`, meeting.ID); err != nil {
		t.Fatal(err)
	}
	history, err := store.AgendaHistory()
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || len(history[0].Emails) != 1 || history[0].Emails[0] != "saved@example.com" {
		t.Fatalf("history=%+v", history)
	}
	assertAgendaHistoryRequiresEmailAndTranscript(t, store)
}

func assertAgendaHistoryRequiresEmailAndTranscript(t *testing.T, store *DB) {
	t.Helper()
	if _, err := store.Conn.Exec(`UPDATE people SET email=''`); err != nil {
		t.Fatal(err)
	}
	history, err := store.AgendaHistory()
	if err != nil || len(history[0].Emails) != 0 {
		t.Fatalf("inferred email: %+v %v", history, err)
	}
	if _, err := store.Conn.Exec(`UPDATE meetings SET transcript=NULL`); err != nil {
		t.Fatal(err)
	}
	history, err = store.AgendaHistory()
	if err != nil || len(history) != 0 {
		t.Fatalf("included ungrounded history: %+v %v", history, err)
	}
}

func TestAgendaHistoryExcludesSelfSpeakerIdentity(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := lifecycleRoundTripMeeting()
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Conn.Exec(`INSERT INTO people(id,name,email) VALUES ('self','You','self@example.com')`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Conn.Exec(`INSERT INTO meeting_speakers(meeting_id,speaker_key,person_id) VALUES (?,?,'self')`, meeting.ID, SpeakerYou); err != nil {
		t.Fatal(err)
	}
	history, err := store.AgendaHistory()
	if err != nil || len(history) != 1 || len(history[0].Emails) != 0 {
		t.Fatalf("self-only evidence: %+v %v", history, err)
	}
}
