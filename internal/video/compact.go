package video

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

const (
	compactingFile = "screen.compacting.mp4"
	// compactedMarker records that the managed movie needs no more compaction, so later passes skip it.
	compactedMarker = "screen.compacted"
	// compactedVersion names the encoder settings in the marker. A movie with an older marker gets one more pass.
	compactedVersion      = "av1-crf40\n"
	compactFreeMargin     = 1 << 30
	activeRecordingWindow = 5 * time.Minute
	compactCandidateLimit = 100
)

// finalVersions are markers of HEVC movies that stay as they are: another lossy pass would cost quality.
var finalVersions = []string{compactedVersion, "keyframes-10s\n", "keyframes-30s\n"}

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
		dir := filepath.Dir(movie)
		if filepath.Base(movie) == db.VideoCompactedFile {
			// Only compaction writes the AV1 copy. Finish a pass that stopped before it removed the original.
			if err := finishCompaction(dir); err != nil {
				return CompactResult{}, err
			}
			continue
		}
		if isFinal(dir) {
			continue
		}
		return compactMovie(ctx, movie)
	}
	return CompactResult{}, nil
}

func isFinal(dir string) bool {
	marker, err := os.ReadFile(filepath.Join(dir, compactedMarker))
	if err != nil {
		return false
	}
	for _, version := range finalVersions {
		if string(marker) == version {
			return true
		}
	}
	return false
}

func compactMovie(ctx context.Context, movie string) (CompactResult, error) {
	encoder, err := EncoderBinary()
	if err != nil {
		return CompactResult{}, err // Retry when the encoder is installed.
	}
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
	err = EncodeAV1(ctx, encoder, movie, temp)
	if ctx.Err() != nil {
		return CompactResult{}, ctx.Err()
	}
	if _, statErr := os.Stat(dir); os.IsNotExist(statErr) {
		return CompactResult{Attempted: true}, nil // The Meeting was deleted during compaction.
	}
	if err != nil {
		// Keep the original and do not retry a movie the encoder cannot read.
		return CompactResult{Attempted: true}, errors.Join(err, markCompacted(dir))
	}
	result := CompactResult{Attempted: true}
	smaller, err := os.Lstat(temp)
	if err != nil {
		return result, err
	}
	if smaller.Size() >= original.Size() {
		return result, markCompacted(dir)
	}
	// Readers prefer the AV1 copy as soon as it exists. A reader that holds the original keeps it until it closes.
	if err := os.Rename(temp, filepath.Join(dir, db.VideoCompactedFile)); err != nil {
		return result, fmt.Errorf("move compacted Screen video into place: %w", err)
	}
	result.SavedBytes = original.Size() - smaller.Size()
	return result, finishCompaction(dir)
}

// finishCompaction removes the original movie that the AV1 copy replaced and records the pass.
func finishCompaction(dir string) error {
	if err := os.Remove(filepath.Join(dir, db.VideoFile)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove Screen video replaced by its AV1 copy: %w", err)
	}
	if isFinal(dir) {
		return nil
	}
	return markCompacted(dir)
}

func markCompacted(dir string) error {
	if err := os.WriteFile(filepath.Join(dir, compactedMarker), []byte(compactedVersion), 0o600); err != nil {
		return fmt.Errorf("record Screen video compaction: %w", err)
	}
	return nil
}
