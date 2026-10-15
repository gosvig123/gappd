package video

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

const (
	compactingFile = "screen.compacting.mov"
	// compactedMarker records that the managed movie needs no more compaction, so later passes skip it.
	compactedMarker       = "screen.compacted"
	compactFreeMargin     = 1 << 30
	activeRecordingWindow = 5 * time.Minute
	compactCandidateLimit = 100
)

type CompactResult struct {
	Attempted  bool
	SavedBytes int64
}

// CompactNext compacts the newest finalized Screen video that has not been compacted yet.
// It waits while a Meeting records, and it keeps the original unless the new movie is complete and smaller.
func CompactNext(ctx context.Context, store *db.DB, root string, now time.Time) (CompactResult, error) {
	active, err := store.HasActiveRecording(now.Add(-activeRecordingWindow).UTC().Format(time.RFC3339))
	if err != nil || active {
		return CompactResult{}, err
	}
	meetings, err := store.ListCompactableVideoMeetings(compactCandidateLimit)
	if err != nil {
		return CompactResult{}, err
	}
	for _, meeting := range meetings {
		movie, err := AssetPath(root, meeting)
		if err != nil {
			continue
		}
		if _, err := os.Lstat(filepath.Join(filepath.Dir(movie), compactedMarker)); err == nil {
			continue
		}
		return compactMovie(ctx, movie)
	}
	return CompactResult{}, nil
}

func compactMovie(ctx context.Context, movie string) (CompactResult, error) {
	dir := filepath.Dir(movie)
	temp := filepath.Join(dir, compactingFile)
	if err := os.Remove(temp); err != nil && !os.IsNotExist(err) {
		return CompactResult{}, fmt.Errorf("remove stale compacted Screen video: %w", err)
	}
	original, err := os.Lstat(movie)
	if err != nil {
		return CompactResult{}, err
	}
	var disk syscall.Statfs_t
	if err := syscall.Statfs(dir, &disk); err != nil {
		return CompactResult{}, fmt.Errorf("check free disk space for Screen video compaction: %w", err)
	}
	if disk.Bavail*uint64(disk.Bsize) < uint64(original.Size())+compactFreeMargin {
		return CompactResult{}, nil // Retry when the disk has room.
	}
	defer os.Remove(temp)
	compacted, err := Compact(ctx, movie, temp)
	if ctx.Err() != nil {
		return CompactResult{}, ctx.Err()
	}
	if _, statErr := os.Stat(dir); os.IsNotExist(statErr) {
		return CompactResult{Attempted: true}, nil // The Meeting was deleted during compaction.
	}
	if err != nil {
		// Keep the original and do not retry a movie the helper cannot encode.
		return CompactResult{Attempted: true}, errors.Join(err, markCompacted(dir))
	}
	result := CompactResult{Attempted: true}
	if compacted {
		smaller, err := os.Lstat(temp)
		if err != nil {
			return result, err
		}
		if smaller.Size() < original.Size() {
			// Rename is atomic on one volume. A reader that holds the old file keeps it until it closes.
			if err := os.Rename(temp, movie); err != nil {
				return result, fmt.Errorf("replace Screen video with compacted movie: %w", err)
			}
			result.SavedBytes = original.Size() - smaller.Size()
		}
	}
	return result, markCompacted(dir)
}

func markCompacted(dir string) error {
	if err := os.WriteFile(filepath.Join(dir, compactedMarker), nil, 0o600); err != nil {
		return fmt.Errorf("record Screen video compaction: %w", err)
	}
	return nil
}

// Compact encodes source again as HEVC into destination. It returns false when source is already HEVC.
func Compact(ctx context.Context, source, destination string) (bool, error) {
	binary, err := Binary()
	if err != nil {
		return false, err
	}
	cmd := exec.CommandContext(ctx, binary, "--compact", source, destination)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("compact Screen video: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	var event Event
	if err := json.Unmarshal(output, &event); err != nil {
		return false, fmt.Errorf("read Screen video compaction result: %w", err)
	}
	switch event.Type {
	case "video_compacted":
		return true, nil
	case "video_compact_unneeded":
		return false, nil
	}
	return false, fmt.Errorf("unexpected Screen video compaction result %q", event.Type)
}
