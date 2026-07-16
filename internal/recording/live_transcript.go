package recording

import (
	"context"
	"fmt"

	"github.com/gappd-dev/gappd/internal/livetranscript"
)

func (w meetingRecordingWorkflow) startLiveTranscript(recorder audioRecorder, meetingID, language string) *livetranscript.Session {
	return w.liveTranscript.Start(context.Background(), livetranscript.StartInput{
		MeetingID: meetingID,
		Language:  language,
		Events:    recorder.TranscriptEvents(),
	})
}

func (w meetingRecordingWorkflow) finishLiveTranscript(session *livetranscript.Session) {
	if _, err := session.Finish(context.Background()); err != nil && w.errOut != nil {
		fmt.Fprintf(w.errOut, "warning: finalize Live Transcript: %v\n", err)
	}
}
