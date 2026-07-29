package capture

import (
	"errors"

	"github.com/gappd-dev/gappd/internal/livetranscript"
)

const captureEventQueueLimit = 256

var errCaptureEventQueueOverflow = errors.New("capture event queue overflow")

type eventRelay struct {
	input       chan livetranscript.Event
	output      chan livetranscript.Event
	discardChan chan struct{}
	done        chan struct{}
}

func newEventRelay() *eventRelay {
	r := &eventRelay{
		input: make(chan livetranscript.Event), output: make(chan livetranscript.Event, captureEventBufferSize),
		discardChan: make(chan struct{}, 1), done: make(chan struct{}),
	}
	go r.run()
	return r
}

func (r *eventRelay) discard() {
	select {
	case r.discardChan <- struct{}{}:
	default:
	}
}

func (r *eventRelay) run() {
	defer close(r.output)
	defer close(r.done)
	queue := []livetranscript.Event{}
	overflowed := false
	input := (<-chan livetranscript.Event)(r.input)
	discard := (<-chan struct{})(r.discardChan)
	for input != nil || len(queue) > 0 {
		var output chan<- livetranscript.Event
		var next livetranscript.Event
		if len(queue) > 0 {
			output, next = r.output, queue[0]
		}
		select {
		case <-discard:
			queue = nil
			discard = nil
		case event, ok := <-input:
			if !ok {
				input = nil
				continue
			}
			if discard == nil || overflowed {
				continue
			}
			if len(queue) < captureEventQueueLimit {
				queue = append(queue, event)
				continue
			}
			queue[len(queue)-1] = livetranscript.Dropped(errCaptureEventQueueOverflow)
			overflowed = true
		case output <- next:
			queue = queue[1:]
		}
	}
}
