package service

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

// The desktop pins the same literal in desktop/src/main/meeting-device.test.ts. The two
// implementations cannot share code, so a format change on either side fails its own test
// instead of silently making every signature invalid.
func TestDeviceMessageIsPinned(t *testing.T) {
	body := []byte(`{"version":1}`)
	digest := sha256.Sum256(body)
	want := "gappd-write-v1\nPOST\n/meeting\n" + strings.Repeat("a", 64) + "\n7\n" + hex.EncodeToString(digest[:])
	got := DeviceMessage("POST", "/meeting", strings.Repeat("a", 64), 7, body)
	if got != want {
		t.Fatalf("signed message drifted:\n got %q\nwant %q", got, want)
	}
	// An account with no generation signs zero, which is what an absent header means.
	absent := strings.Split(DeviceMessage("DELETE", "/meeting", strings.Repeat("b", 64), 0, nil), "\n")
	if len(absent) != 6 || absent[4] != "0" || absent[5] != hex.EncodeToString(sha256.New().Sum(nil)) {
		t.Fatalf("an absent generation is not signed as zero: %q", absent)
	}
}
