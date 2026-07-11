package audioartifact

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDeleteSessionUnderRejectsOutsideAndDeletesInside(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "meeting")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := DeleteSessionUnder(root, outside); err == nil {
		t.Fatal("outside deletion accepted")
	}
	inside := filepath.Join(root, "sessions", "meeting")
	if err := os.MkdirAll(inside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := DeleteSessionUnder(root, inside); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(inside); !os.IsNotExist(err) {
		t.Fatalf("deleted path stat = %v", err)
	}
}
