package video

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestManagedFileRejectsForeignAndSymlink(t *testing.T) {
	dir := t.TempDir()
	if _, err := ManagedFile(dir, "../secret.mov"); err == nil {
		t.Fatal("accepted arbitrary filename")
	}
	target := filepath.Join(dir, "outside")
	if err := os.WriteFile(target, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(dir, db.VideoPartialFile)); err != nil {
		t.Fatal(err)
	}
	if _, err := ManagedFile(dir, db.VideoPartialFile); err == nil {
		t.Fatal("accepted symlink")
	}
	if err := os.Remove(filepath.Join(dir, db.VideoPartialFile)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, db.VideoPartialFile), []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ManagedFile(dir, db.VideoPartialFile); err != nil {
		t.Fatal(err)
	}
}

func TestValidVideoEvents(t *testing.T) {
	for _, event := range []Event{{Type: "video_started", SourceType: "other", HostSeconds: 1}, {Type: "video_finalized", SourceType: "window", HostSeconds: 0}, {Type: "unknown"}} {
		if valid(event) {
			t.Fatalf("accepted %+v", event)
		}
	}
	if !valid(Event{Type: "video_started", SourceType: "display", HostSeconds: 23.5}) {
		t.Fatal("rejected valid start")
	}
}

func TestAssetPathChecksMeetingAndCanonicalContainment(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "sessions", "meeting")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, db.VideoFile)
	if err := os.WriteFile(file, []byte("movie"), 0600); err != nil {
		t.Fatal(err)
	}
	name := db.VideoFile
	meeting := db.Meeting{AudioPath: &dir, VideoFile: &name, VideoState: "ready"}
	if path, err := AssetPath(root, meeting); err != nil || path != file {
		t.Fatalf("path=%q err=%v", path, err)
	}
	meeting.VideoState = "recording"
	if _, err := AssetPath(root, meeting); err == nil {
		t.Fatal("accepted unfinalized movie")
	}
	meeting.VideoState = "ready"
	outside := t.TempDir()
	meeting.AudioPath = &outside
	if _, err := AssetPath(root, meeting); err == nil {
		t.Fatal("accepted external movie")
	}
}
