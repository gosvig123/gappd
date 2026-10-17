package video

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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
	cmd := exec.CommandContext(ctx, encoder, "-nostdin", "-hide_banner", "-v", "error", "-xerror",
		"-i", source, "-map", "0:v:0", "-an", "-sn", "-dn",
		"-fps_mode", "passthrough", "-enc_time_base", "demux",
		"-c:v", "libsvtav1", "-preset", "6", "-crf", "40", "-g", "450", "-svtav1-params", "scd=0:lp=2",
		"-movflags", "+faststart", "-f", "mp4", "-y", destination)
	cmd.Env = append(os.Environ(), "SVT_LOG=1") // Errors only.
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start AV1 encoder: %w", err)
	}
	_ = syscall.Setpriority(syscall.PRIO_PROCESS, cmd.Process.Pid, encoderPriority)
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("encode Screen video as AV1: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}
