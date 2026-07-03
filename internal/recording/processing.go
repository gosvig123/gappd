package recording

import (
	"io"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
)

type meetingProcessing struct {
	store         meetingStore
	transcriber   transcriber
	notesEnhancer enhancer
	pipeline      *ai.Pipeline
	out           io.Writer
	errOut        io.Writer
	events        EventSink
}

func (s Service) processing() meetingProcessing {
	return meetingProcessing{
		store: s.meetings(), transcriber: s.transcriber, notesEnhancer: s.enhancer,
		pipeline: s.Pipeline, out: s.Out, errOut: s.ErrOut, events: s.Events,
	}
}

func (p meetingProcessing) sessionFor(meeting *db.Meeting, artifacts audioartifact.Artifacts) recordingSession {
	return recordingSession{
		store: p.store, out: p.out, errOut: p.errOut,
		events: p.events, meeting: meeting, artifacts: artifacts,
	}
}
