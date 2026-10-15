package appprotocol

import (
	"encoding/json"
	"github.com/gappd-dev/gappd/internal/db"
	"strings"
	"testing"
)

func TestSpeakerViewExposesOriginWithoutVoiceEvidence(t *testing.T) {
	id := "person"
	views := buildSpeakerViews([]db.Segment{{Speaker: "Alice", SpeakerKey: "Speaker 1", PersonID: &id, IdentityOrigin: "automatic"}})
	raw, err := json.Marshal(views)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"identityOrigin":"automatic"`) {
		t.Fatal("missing automatic provenance")
	}
	for _, field := range []string{"centroid", "embedding", "vector"} {
		if strings.Contains(string(raw), field) {
			t.Fatal("voice evidence exposed")
		}
	}
}
