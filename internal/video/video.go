package video

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/processgroup"
)

const StopTimeout = 12 * time.Second // Measured callback wait remains a packaged-app release gate.

type Event struct {
	Type        string  `json:"type"`
	SourceType  string  `json:"sourceType"`
	HostSeconds float64 `json:"hostSeconds"`
	Reason      string  `json:"reason"`
}

func Binary() (string, error) {
	if path := os.Getenv("GAPPD_VIDEO_HELPER_PATH"); path != "" {
		if _, err := os.Stat(path); err != nil {
			return "", err
		}
		return path, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(exe)
	for _, path := range []string{
		filepath.Join(dir, "GappdVideo.app/Contents/MacOS/gappd-video"),
		filepath.Join(dir, "../GappdVideo.app/Contents/MacOS/gappd-video"),
		filepath.Join(dir, "../Resources/GappdVideo.app/Contents/MacOS/gappd-video"),
		filepath.Join(os.Getenv("HOME"), ".gappd/GappdVideo.app/Contents/MacOS/gappd-video"),
		"build/GappdVideo.app/Contents/MacOS/gappd-video",
	} {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	return "", errors.New("gappd-video helper not found")
}

// Run owns only the video process. Its errors do not alter the audio capture result.
func Run(ctx context.Context, dir string, emit func(Event)) error {
	binary, err := Binary()
	if err != nil {
		return err
	}
	cmd := exec.Command(binary, "--output-dir", dir)
	stdout, writer, err := os.Pipe()
	if err != nil {
		return err
	}
	defer stdout.Close()
	cmd.Stdout = writer
	var stderr strings.Builder
	cmd.Stderr = &stderr
	processgroup.Configure(cmd)
	if err := cmd.Start(); err != nil {
		writer.Close()
		return err
	}
	writer.Close()
	scanned := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 64<<10)
		for scanner.Scan() {
			var event Event
			if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
				continue
			}
			if valid(event) {
				emit(event)
			}
		}
		scanned <- scanner.Err()
	}()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var waitErr error
	select {
	case waitErr = <-done:
	case <-ctx.Done():
		_ = processgroup.Signal(cmd, syscall.SIGINT)
		timer := time.NewTimer(StopTimeout)
		select {
		case waitErr = <-done:
		case <-timer.C:
			_ = processgroup.Signal(cmd, syscall.SIGKILL)
			waitErr = fmt.Errorf("video finish callback timed out after %s", StopTimeout)
			select {
			case <-done:
			case <-time.After(2 * time.Second):
			}
		}
		timer.Stop()
	}
	select {
	case err = <-scanned:
	case <-time.After(2 * time.Second):
		err = errors.New("video output drain timed out")
	}
	if waitErr != nil {
		return fmt.Errorf("video helper: %w: %s", waitErr, stderr.String())
	}
	return err
}

func valid(e Event) bool {
	switch e.Type {
	case "video_started", "video_finalized":
		if e.SourceType != "window" && e.SourceType != "display" {
			return false
		}
		return e.HostSeconds > 0 && !math.IsNaN(e.HostSeconds) && !math.IsInf(e.HostSeconds, 0)
	case "video_cancelled", "video_skipped", "video_ended", "video_failed":
		return true
	}
	return false
}

func ManagedFile(dir string, name string) (string, error) {
	if name != db.VideoFile && name != db.VideoPartialFile {
		return "", errors.New("invalid managed video filename")
	}
	path := filepath.Join(dir, name)
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("video is not a regular file")
	}
	return path, nil
}

// Inspect uses AVFoundation, not filesystem timestamps or a guessed MOV header.
func Inspect(ctx context.Context, path string) (float64, error) {
	binary, err := Binary()
	if err != nil {
		return 0, err
	}
	output, err := exec.CommandContext(ctx, binary, "--inspect", path).Output()
	if err != nil {
		return 0, err
	}
	var event Event
	if err := json.Unmarshal(output, &event); err != nil {
		return 0, err
	}
	if event.Type != "video_inspected" || event.HostSeconds <= 0 || math.IsNaN(event.HostSeconds) || math.IsInf(event.HostSeconds, 0) {
		return 0, errors.New("movie has no playable duration")
	}
	return event.HostSeconds, nil
}

// AssetPath returns a main-process-only managed movie path. Never pass it to a renderer.
func AssetPath(root string, meeting db.Meeting) (string, error) {
	if meeting.VideoState != "ready" && meeting.VideoState != "ended" {
		return "", errors.New("Screen video is not ready")
	}
	if meeting.AudioPath == nil || meeting.VideoFile == nil || *meeting.VideoFile != db.VideoFile {
		return "", errors.New("Meeting has no finalized managed movie")
	}
	sessions, err := filepath.Abs(filepath.Join(root, "sessions"))
	if err != nil {
		return "", err
	}
	dir, err := filepath.Abs(*meeting.AudioPath)
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(sessions, dir)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return "", errors.New("movie directory is outside managed sessions")
	}
	realRoot, err := filepath.EvalSymlinks(sessions)
	if err != nil {
		return "", err
	}
	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", err
	}
	realRelative, err := filepath.Rel(realRoot, realDir)
	if err != nil || realRelative != relative {
		return "", errors.New("movie directory uses a symlink")
	}
	return ManagedFile(dir, db.VideoFile)
}
