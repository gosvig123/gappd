package meetinglifecycle

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/db"
)

// UnclaimedRevision binds an enhancement result to the transcript it actually read.
// The ordinary transition CAS also checks the claim token, including on retries.
type UnclaimedRevision struct {
	Transition
	TranscriptRevision int
}

func (t UnclaimedRevision) apply(meeting *db.Meeting) (bool, error) {
	if meeting.TranscriptRevision != t.TranscriptRevision || meeting.ProcessingClaimToken != nil {
		return false, fmt.Errorf("%s meeting %s: transcript changed or processing was claimed; retry enhancement after current processing finishes", t.name(), meeting.ID)
	}
	return t.Transition.apply(meeting)
}
