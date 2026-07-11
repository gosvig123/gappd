package recording

import "github.com/gappd-dev/gappd/internal/meetingprocessing"

type processingEventAdapter struct{ events EventSink }

func (a processingEventAdapter) EmitProcessingEvent(event meetingprocessing.Event) error {
	if a.events == nil {
		return nil
	}
	return a.events.EmitRecordingEvent(recordingEventName(event.Name), event.Meeting, event.Err)
}

func recordingEventName(name meetingprocessing.EventName) EventName {
	switch name {
	case meetingprocessing.EventProcessing:
		return EventProcessing
	case meetingprocessing.EventCompleted:
		return EventCompleted
	default:
		return EventFailed
	}
}
