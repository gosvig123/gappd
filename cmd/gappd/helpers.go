package main

import (
	"fmt"
	"path/filepath"

	"github.com/gappd-dev/gappd/internal/config"
)

func defaultModelPath() (string, error) {
	dir, err := config.GappdDir()
	if err != nil {
		return "", fmt.Errorf("resolve gappd dir for model path: %w", err)
	}
	return filepath.Join(dir, "models", "ggml-small.en-q5_1.bin"), nil
}
