package audioartifact

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/gappd-dev/gappd/internal/db"
)

// ChunksDirname holds the capture helper's provisional Live Transcript audio windows.
// They copy mic.wav and system.wav, and nothing reads them after the recording ends.
const ChunksDirname = "chunks"

// RemoveChunks deletes a session's Live Transcript chunks and returns the bytes freed.
func RemoveChunks(sessionDir string) (int64, error) {
	dir := filepath.Join(sessionDir, ChunksDirname)
	info, err := os.Lstat(dir)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !info.IsDir() {
		return 0, fmt.Errorf("remove Live Transcript chunks %s: not a directory", dir)
	}
	var size int64
	_ = filepath.WalkDir(dir, func(_ string, entry fs.DirEntry, err error) error {
		if err == nil && entry.Type().IsRegular() {
			if info, err := entry.Info(); err == nil {
				size += info.Size()
			}
		}
		return nil
	})
	if err := os.RemoveAll(dir); err != nil {
		return 0, fmt.Errorf("remove Live Transcript chunks %s: %w", dir, err)
	}
	return size, nil
}

// RemoveFinishedChunks deletes leftover chunks of Meetings that are not recording, such as interrupted recordings.
func RemoveFinishedChunks(store *db.DB, gappdRoot string) (int64, error) {
	dirs, err := store.ListFinishedSessionDirs()
	if err != nil {
		return 0, err
	}
	sessionsRoot := filepath.Join(gappdRoot, "sessions")
	var freed int64
	for _, dir := range dirs {
		if inside, err := pathInside(dir, sessionsRoot); err != nil || !inside {
			continue
		}
		size, err := RemoveChunks(dir)
		if err != nil {
			return freed, err
		}
		freed += size
	}
	return freed, nil
}
