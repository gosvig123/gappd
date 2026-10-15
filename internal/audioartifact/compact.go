package audioartifact

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
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
		if err := verifySamples(ctx, pair); err != nil {
			if ctx.Err() != nil {
				return CompactResult{}, ctx.Err()
			}
			// Readers prefer the FLAC, so a copy that cannot be proven equal is removed and not made again.
			cleanup := errors.Join(os.Remove(pair.flac), os.WriteFile(filepath.Join(dir, compactionFailedMarker), nil, 0o600))
			return result, fmt.Errorf("compact Meeting audio %s: %w (%v)", pair.wav, err, cleanup)
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

// verifySamples decodes the FLAC again and compares its samples with the WAV, so the WAV is deleted
// only when the FLAC holds exactly the same audio.
func verifySamples(ctx context.Context, pair audioPair) error {
	decoded := strings.TrimSuffix(pair.flac, ".flac") + ".verifying.wav"
	defer os.Remove(decoded)
	if output, err := exec.CommandContext(ctx, afconvertPath, "-f", "WAVE", "-d", "LEI16", pair.flac, decoded).CombinedOutput(); err != nil {
		return fmt.Errorf("decode FLAC copy: %w: %s", err, output)
	}
	want, err := wavDataDigest(pair.wav)
	if err != nil {
		return err
	}
	got, err := wavDataDigest(decoded)
	if err != nil {
		return err
	}
	if want != got {
		return errors.New("FLAC copy has different samples than the WAV")
	}
	return nil
}

// wavDataDigest hashes the samples in a WAV file's data chunk. It skips other chunks, because the
// decoder may write a different header than the capture helper.
func wavDataDigest(path string) ([sha256.Size]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return [sha256.Size]byte{}, err
	}
	defer file.Close()
	var riff [12]byte
	if _, err := io.ReadFull(file, riff[:]); err != nil || string(riff[0:4]) != "RIFF" || string(riff[8:12]) != "WAVE" {
		return [sha256.Size]byte{}, errUnsupportedAudio
	}
	for {
		var chunk [8]byte
		if _, err := io.ReadFull(file, chunk[:]); err != nil {
			return [sha256.Size]byte{}, errUnsupportedAudio
		}
		size := int64(binary.LittleEndian.Uint32(chunk[4:]))
		if string(chunk[0:4]) == "data" {
			digest := sha256.New()
			if n, err := io.Copy(digest, io.LimitReader(file, size)); err != nil || n != size {
				return [sha256.Size]byte{}, errUnsupportedAudio
			}
			return [sha256.Size]byte(digest.Sum(nil)), nil
		}
		if _, err := file.Seek(size+size%2, io.SeekCurrent); err != nil {
			return [sha256.Size]byte{}, err
		}
	}
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
