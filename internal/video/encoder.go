package video

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// encoderPriority keeps the AV1 encode behind interactive work; it runs for minutes on every core it gets.
const encoderPriority = 10

// EncoderBinary finds gappd-ffmpeg, the bundled LGPL ffmpeg with the SVT-AV1 encoder and the dav1d decoder.
func EncoderBinary() (string, error) {
	if path := os.Getenv("GAPPD_FFMPEG_PATH"); path != "" {
		if _, err := os.Stat(path); err != nil {
			return "", fmt.Errorf("AV1 encoder at GAPPD_FFMPEG_PATH: %w", err)
		}
		return path, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(exe)
	for _, path := range []string{
		filepath.Join(dir, "../ffmpeg/gappd-ffmpeg"),                   // Packaged: Resources/bin/gappd.
		filepath.Join(dir, "../desktop/resources/ffmpeg/gappd-ffmpeg"), // Development: build/gappd.
		"desktop/resources/ffmpeg/gappd-ffmpeg",
	} {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	return "", errors.New("AV1 encoder gappd-ffmpeg not found; run `npm run prepare:ffmpeg` in desktop/")
}

// EncodeAV1 writes source's video track as AV1 into an MP4 at destination.
// Every frame keeps its source timestamp, so replay and export keep their measured start times.
// CRF 40 measured at least as sharp as the HEVC it replaces, at 15-60% of the size.
// lp=2 holds the encoder near 700 MB of memory; the default used over 1 GB.
// The 450-frame keyframe interval is 30 s at the 15 fps capture rate.
func EncodeAV1(ctx context.Context, encoder, source, destination string) error {
	if _, err := runEncoder(ctx, encoder, "-i", source, "-map", "0:v:0", "-an", "-sn", "-dn",
		"-fps_mode", "passthrough", "-enc_time_base", "demux",
		"-c:v", "libsvtav1", "-preset", "6", "-crf", "40", "-g", "450", "-svtav1-params", "scd=0:lp=2",
		"-movflags", "+faststart", "-f", "mp4", "-y", destination); err != nil {
		return fmt.Errorf("encode Screen video as AV1: %w", err)
	}
	return nil
}

// VerifyAV1 decodes the AV1 copy with dav1d and checks that it holds every frame of source,
// so compaction deletes the original only when its copy is complete and playable.
func VerifyAV1(ctx context.Context, encoder, source, compacted string) error {
	want, err := frameCount(ctx, encoder, "-i", source, "-map", "0:v:0", "-c", "copy")
	if err != nil {
		return fmt.Errorf("count Screen video frames: %w", err)
	}
	got, err := frameCount(ctx, encoder, "-c:v", "libdav1d", "-i", compacted, "-map", "0:v:0", "-fps_mode", "passthrough")
	if err != nil {
		return fmt.Errorf("decode AV1 copy of Screen video: %w", err)
	}
	if want == 0 || got != want {
		return fmt.Errorf("AV1 copy of Screen video has %d frames, but the original has %d", got, want)
	}
	return nil
}

// frameCount reads input to the null muxer and returns the last frame count ffmpeg reports.
func frameCount(ctx context.Context, encoder string, input ...string) (int, error) {
	output, err := runEncoder(ctx, encoder, append(input, "-f", "null", "-progress", "pipe:1", "-nostats", "-")...)
	if err != nil {
		return 0, err
	}
	count := -1
	for _, line := range strings.Split(output, "\n") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(line), "frame="); ok {
			if n, err := strconv.Atoi(value); err == nil {
				count = n
			}
		}
	}
	if count < 0 {
		return 0, errors.New("ffmpeg reported no frame count")
	}
	return count, nil
}

// runEncoder runs gappd-ffmpeg at low priority, stops on the first error, and returns its stdout.
func runEncoder(ctx context.Context, encoder string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, encoder, append([]string{"-nostdin", "-hide_banner", "-v", "error", "-xerror"}, args...)...)
	cmd.Env = append(os.Environ(), "SVT_LOG=1") // Errors only.
	var stdout, stderr strings.Builder
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start gappd-ffmpeg: %w", err)
	}
	_ = syscall.Setpriority(syscall.PRIO_PROCESS, cmd.Process.Pid, encoderPriority)
	if err := cmd.Wait(); err != nil {
		return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}
