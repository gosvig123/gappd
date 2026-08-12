package meetingprocessing

import "errors"

type Capability string

const (
	CapabilityTranscription Capability = "transcription"
	CapabilityDiarization   Capability = "diarization"
	CapabilitySummarization Capability = "summarization"
)

var AllCapabilities = []Capability{CapabilityTranscription, CapabilityDiarization, CapabilitySummarization}

type DrainResult struct {
	Capability Capability `json:"capability"`
	Attempted  int        `json:"attempted"`
	Completed  int        `json:"completed"`
	Requeued   int        `json:"requeued"`
	Failed     int        `json:"failed"`
}

type ErrorCategory string

const (
	ErrorTransient     ErrorCategory = "transient"
	ErrorDeterministic ErrorCategory = "deterministic"
)

type CategorizedError struct {
	Category ErrorCategory
	Err      error
}

func (e *CategorizedError) Error() string { return e.Err.Error() }
func (e *CategorizedError) Unwrap() error { return e.Err }

func deterministic(err error) error { return &CategorizedError{Category: ErrorDeterministic, Err: err} }
func category(err error) ErrorCategory {
	var value *CategorizedError
	if errors.As(err, &value) {
		return value.Category
	}
	if errors.Is(err, ErrNoAudio) || errors.Is(err, ErrNoTranscript) {
		return ErrorDeterministic
	}
	return ErrorTransient
}
