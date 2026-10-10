package selectedfixture

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestLocalMeetingExportAndChangedContent(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	profile := filepath.Join(root, "profile")
	if err := Bootstrap(profile); err != nil {
		t.Fatal(err)
	}
	data, err := Export(profile, ID)
	if err != nil || string(data) != Bytes {
		t.Fatalf("export differs: %v", err)
	}
	if _, err = Export("/must-not-open", "real-meeting"); err == nil {
		t.Fatal("arbitrary ID accepted")
	}
	assertChangedLocalTranscriptRefused(t, profile)
}

func assertChangedLocalTranscriptRefused(t *testing.T, profile string) {
	t.Helper()
	store, err := db.Open(DatabasePath(profile))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err = store.Conn.Exec(`UPDATE meetings SET transcript='private-shaped data' WHERE id=?`, ID); err != nil {
		t.Fatal(err)
	}
	if _, err = Export(profile, ID); err == nil {
		t.Fatal("changed transcript exported")
	}
}

func TestBootstrapRefusesExistingAndSymlink(t *testing.T) {
	root := t.TempDir()
	if err := Bootstrap(root); err == nil {
		t.Fatal("existing destination accepted")
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(filepath.Join(root, "absent"), link); err != nil {
		t.Fatal(err)
	}
	if err := Bootstrap(link); err == nil {
		t.Fatal("symlink accepted")
	}
}

func TestEveryExportedFieldMustMatchFixture(t *testing.T) {
	for _, change := range []func(*db.Meeting){
		func(m *db.Meeting) { m.ID = "another-local-id" },
		func(m *db.Meeting) { m.Title = "private title" },
		func(m *db.Meeting) { m.Transcript = pointer("private transcript") },
		func(m *db.Meeting) { m.Summary = pointer("private summary") },
		func(m *db.Meeting) { m.StartedAt = "2026-09-15T00:00:00Z" },
		func(m *db.Meeting) { m.TranscriptRevision = 2 },
		func(m *db.Meeting) { m.SummaryTranscriptRevision = 2 },
	} {
		meeting := Meeting()
		change(meeting)
		if _, err := Serialize(meeting); err == nil {
			t.Fatal("changed document accepted")
		}
	}
}
