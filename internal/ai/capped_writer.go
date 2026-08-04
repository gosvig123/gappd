package ai

import (
	"bytes"
	"fmt"
	"io"
	"os"
)

type cappedWriter struct {
	data      bytes.Buffer
	remaining int
}

func readCodexResult(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read Codex result: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, codexResultLimit+1))
	if err != nil {
		return nil, fmt.Errorf("read Codex result: %w", err)
	}
	if len(data) > codexResultLimit {
		return nil, fmt.Errorf("Codex result exceeds %d bytes", codexResultLimit)
	}
	return bytes.TrimSpace(data), nil
}

func (w *cappedWriter) Write(data []byte) (int, error) {
	if w.remaining > 0 {
		keep := len(data)
		if keep > w.remaining {
			keep = w.remaining
		}
		_, _ = w.data.Write(data[:keep])
		w.remaining -= keep
	}
	return len(data), nil
}
