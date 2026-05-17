package main

import (
	"fmt"
	"path/filepath"

	"github.com/gappd-dev/gappd/internal/db"
)

func defaultModelPath() (string, error) {
	dir, err := gappdDir()
	if err != nil {
		return "", fmt.Errorf("resolve gappd dir for model path: %w", err)
	}
	return filepath.Join(dir, "models", "ggml-base.en.bin"), nil
}

func setMeetingProcessingStatus(meeting *db.Meeting, status db.ProcessingStatus, updatedAt string, err error) {
	meeting.ProcessingStatus = status
	meeting.ProcessingStatusUpdatedAt = updatedAt
	meeting.ProcessingFailureMessage = nil
	if err != nil {
		message := err.Error()
		meeting.ProcessingFailureMessage = &message
	}
}
