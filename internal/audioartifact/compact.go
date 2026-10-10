package audioartifact

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/gappd-dev/gappd/internal/db"
)

const (
	// afconvertPath is the macOS audio converter; its FLAC encoder is lossless.
	afconvertPath = "/usr/bin/afconvert"
	// compactionFailedMarker stops later passes from retrying audio that the encoder rejected.
	compactionFailedMarker = "audio.compaction-failed"
	compactFreeMargin      = 1 << 30
)

var errLowDisk = errors.New("not enough free disk space")

type CompactResult struct {
	Attempted  bool
	SavedBytes int64
}

type audioPair struct{ wav, flac string }

// CompactNextAudio replaces the capture WAVs of the newest idle Meeting with verified lossless FLAC copies.
// A Meeting is idle when capture and processing have finished and speaker labeling is not waiting or running,
// because those readers open the WAV again by path.
func CompactNextAudio(ctx context.Context, store *db.DB, gappdRoot string) (CompactResult, error) {
	meetings, err := store.ListCompactableAudioMeetings(200)
	if err != nil {
		return CompactResult{}, err
	}
	sessionsRoot := filepath.Join(gappdRoot, "sessions")
	for _, meeting := range meetings {
		dir := *meeting.AudioPath
		if inside, err := pathInside(dir, sessionsRoot); err != nil || !inside || !idle(meeting) {
			continue
		}
		if _, err := os.Lstat(filepath.Join(dir, compactionFailedMarker)); err == nil {
			continue
		}
		pairs := pendingPairs(dir)
		if len(pairs) == 0 {
			continue
		}
		return compactMeetingAudio(ctx, store, meeting.ID, dir, pairs)
	}
	return CompactResult{}, nil
}

func idle(meeting db.Meeting) bool {
	return meeting.CaptureStatus == db.CaptureStatusCaptured &&
		(meeting.ProcessingStatus == db.ProcessingStatusCompleted || meeting.ProcessingStatus == db.ProcessingStatusFailed) &&
		meeting.DiarizationState != db.DiarizationStatePending && meeting.DiarizationState != db.DiarizationStateProcessing
}

// pendingPairs lists capture WAVs that hold audio in the format the capture helper writes.
func pendingPairs(dir string) []audioPair {
	var pairs []audioPair
	for _, pair := range []audioPair{{MicFilename, MicFLACFilename}, {SystemFilename, SystemFLACFilename}} {
		wav := filepath.Join(dir, pair.wav)
		if info, err := os.Lstat(wav); err != nil || !info.Mode().IsRegular() {
			continue
		}
		if _, err := ReadPCM16(wav); err == nil {
			pairs = append(pairs, audioPair{wav: wav, flac: filepath.Join(dir, pair.flac)})
		}
	}
	return pairs
}

func compactMeetingAudio(ctx context.Context, store *db.DB, id, dir string, pairs []audioPair) (CompactResult, error) {
	result := CompactResult{Attempted: true}
	for _, pair := range pairs {
		wav, err := ReadPCM16(pair.wav)
		if err != nil {
			continue
		}
		if _, err := os.Lstat(pair.flac); os.IsNotExist(err) {
			if err := encodeFLAC(ctx, dir, pair, wav); err != nil {
				if ctx.Err() != nil {
					return CompactResult{}, ctx.Err()
				}
				if errors.Is(err, errLowDisk) {
					return CompactResult{}, nil // Retry when the disk has room.
				}
				// Keep the WAV and do not retry audio the encoder rejected.
				markErr := os.WriteFile(filepath.Join(dir, compactionFailedMarker), nil, 0o600)
				return result, fmt.Errorf("compact Meeting audio %s: %w (%v)", pair.wav, err, markErr)
			}
		}
		// Readers now open the FLAC. Delete the WAV only if no reader may still hold its path.
		if flac, err := ReadPCM16(pair.flac); err != nil || flac != wav {
			return result, fmt.Errorf("compact Meeting audio %s: FLAC copy does not match the WAV", pair.wav)
		}
		meeting, err := store.GetMeeting(id)
		if err != nil || !idle(*meeting) {
			return result, err // A later pass deletes the WAV.
		}
		saved, err := replacedBytes(pair)
		if err != nil {
			return result, err
		}
		result.SavedBytes += saved
	}
	return result, nil
}

// encodeFLAC writes a lossless copy beside the WAV and moves it into place only after its length matches.
func encodeFLAC(ctx context.Context, dir string, pair audioPair, wav PCM16) error {
	temp := strings.TrimSuffix(pair.flac, ".flac") + ".compacting.flac" // ReadPCM16 picks the parser by extension.
	if err := os.Remove(temp); err != nil && !os.IsNotExist(err) {
		return err
	}
	defer os.Remove(temp)
	original, err := os.Lstat(pair.wav)
	if err != nil {
		return err
	}
	var disk syscall.Statfs_t
	if err := syscall.Statfs(dir, &disk); err != nil {
		return err
	}
	if disk.Bavail*uint64(disk.Bsize) < uint64(original.Size())+compactFreeMargin {
		return errLowDisk
	}
	if output, err := exec.CommandContext(ctx, afconvertPath, "-f", "flac", "-d", "flac", pair.wav, temp).CombinedOutput(); err != nil {
		return fmt.Errorf("afconvert: %w: %s", err, output)
	}
	if flac, err := ReadPCM16(temp); err != nil || flac != wav {
		return fmt.Errorf("FLAC copy has a different format or length than the WAV")
	}
	return os.Rename(temp, pair.flac)
}

func replacedBytes(pair audioPair) (int64, error) {
	wav, err := os.Lstat(pair.wav)
	if err != nil {
		return 0, err
	}
	flac, err := os.Lstat(pair.flac)
	if err != nil {
		return 0, err
	}
	if err := os.Remove(pair.wav); err != nil {
		return 0, fmt.Errorf("remove compacted Meeting audio %s: %w", pair.wav, err)
	}
	return wav.Size() - flac.Size(), nil
}
