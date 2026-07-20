package diarize

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The test binary doubles as the real, freshly launched helper process.
func TestMain(m *testing.M) {
	if mode := os.Getenv("GAPPD_DIARIZE_FAKE"); mode != "" {
		fakeHelper(mode)
		os.Exit(0)
	}
	os.Exit(m.Run())
}
func fakeHelper(mode string) {
	if len(os.Args) != 5 || os.Args[1] != os.Getenv("FAKE_AUDIO") || os.Args[4] != os.Getenv("FAKE_MODELS") {
		os.Exit(2)
	}
	start, _ := strconv.ParseInt(os.Args[2], 10, 64)
	count, _ := strconv.ParseInt(os.Args[3], 10, 64)
	if log := os.Getenv("FAKE_LOG"); log != "" {
		f, _ := os.OpenFile(log, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		fmt.Fprintf(f, "%d:%d\n", start, count)
		f.Close()
	}
	switch mode {
	case "hang":
		signal.Ignore(syscall.SIGTERM)
		for {
			time.Sleep(time.Hour)
		}
	case "malformed":
		fmt.Print("{")
		return
	case "trailing":
		fmt.Print(validJSON(start, count), "{}")
		return
	case "oversized":
		fmt.Print(strings.Repeat("x", maxReportBytes+1))
		return
	case "wrong":
		start++
	}
	fmt.Print(validJSON(start, count))
}
func validJSON(start, count int64) string {
	return fmt.Sprintf(`{"schemaVersion":1,"engine":%q,"engineRevision":%q,"requestedStartFrame":%d,"requestedFrameCount":%d,"clusters":[{"localClusterID":"a","centroid":[1,0]}],"spans":[{"localClusterID":"a","startSeconds":0,"endSeconds":1,"qualityScore":0.8,"identityScore":0.7}]}`, reportEngine, reportRevision, start, count)
}
func writeWAV(t *testing.T, frames int64) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "audio.wav")
	data := uint32(frames * 2)
	h := make([]byte, 44)
	copy(h, "RIFF")
	binary.LittleEndian.PutUint32(h[4:], data+36)
	copy(h[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(h[16:], 16)
	binary.LittleEndian.PutUint16(h[20:], 1)
	binary.LittleEndian.PutUint16(h[22:], 1)
	binary.LittleEndian.PutUint32(h[24:], 16000)
	binary.LittleEndian.PutUint32(h[28:], 32000)
	binary.LittleEndian.PutUint16(h[32:], 2)
	binary.LittleEndian.PutUint16(h[34:], 16)
	copy(h[36:], "data")
	binary.LittleEndian.PutUint32(h[40:], data)
	if err := os.WriteFile(path, h, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(path, int64(44+data)); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAttemptTimeout(t *testing.T) {
	for minutes, want := range map[int]time.Duration{15: 45 * time.Second, 60: 90 * time.Second, 120: 150 * time.Second} {
		if got := attemptTimeout(int64(minutes) * 60 * sampleRate); got != want {
			t.Errorf("timeout(%d minutes) = %v, want %v", minutes, got, want)
		}
	}
}

func TestWAVValidationAndRanges(t *testing.T) {
	path := writeWAV(t, 32000)
	if got, err := wavFrames(path); err != nil || got != 32000 {
		t.Fatalf("frames=%d err=%v", got, err)
	}
	good, _ := os.ReadFile(path)
	for _, tc := range []struct {
		name  string
		at    int
		value byte
	}{{"riff", 0, 'X'}, {"pcm", 20, 2}, {"mono", 22, 2}, {"rate", 24, 1}, {"data", 36, 'X'}, {"size", 40, 1}} {
		t.Run(tc.name, func(t *testing.T) {
			bad := filepath.Join(t.TempDir(), "bad.wav")
			b := append([]byte(nil), good...)
			b[tc.at] = tc.value
			_ = os.WriteFile(bad, b, 0600)
			if _, err := wavFrames(bad); err == nil {
				t.Fatal("accepted invalid WAV")
			}
		})
	}
	tests := []struct {
		frames int64
		want   []frameRange
	}{
		{570 * sampleRate, []frameRange{{0, 570 * sampleRate}}},
		{571 * sampleRate, []frameRange{{0, 571 * sampleRate}}},
		{599 * sampleRate, []frameRange{{0, 599 * sampleRate}}},
		{600 * sampleRate, []frameRange{{0, windowFrames}, {windowStepFrames, 30 * sampleRate}}},
		{601 * sampleRate, []frameRange{{0, windowFrames}, {windowStepFrames, 31 * sampleRate}}},
		{1140 * sampleRate, []frameRange{{0, windowFrames}, {windowStepFrames, 570 * sampleRate}}},
		{1141 * sampleRate, []frameRange{{0, windowFrames}, {windowStepFrames, 571 * sampleRate}}},
		{1169 * sampleRate, []frameRange{{0, windowFrames}, {windowStepFrames, 599 * sampleRate}}},
		{windowStepFrames + windowFrames + 10, []frameRange{{0, windowFrames}, {windowStepFrames, windowFrames}, {2 * windowStepFrames, windowFrames - windowStepFrames + 10}}},
	}
	for _, tc := range tests {
		if got := frameRanges(tc.frames); fmt.Sprint(got) != fmt.Sprint(tc.want) {
			t.Errorf("ranges(%d)=%v want %v", tc.frames, got, tc.want)
		}
	}
}
func supervisorFor(t *testing.T, frames int64, mode string) (Supervisor, string) {
	t.Helper()
	audio := writeWAV(t, frames)
	models := t.TempDir()
	t.Setenv("GAPPD_DIARIZE_FAKE", mode)
	t.Setenv("FAKE_AUDIO", audio)
	t.Setenv("FAKE_MODELS", models)
	return Supervisor{os.Args[0], models}, audio
}
func TestSupervisorSequentialWindows(t *testing.T) {
	s, audio := supervisorFor(t, windowFrames, "success")
	log := filepath.Join(t.TempDir(), "calls")
	t.Setenv("FAKE_LOG", log)
	got, err := s.Run(context.Background(), audio)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].DurationSeconds != 600 || got[1].StartSeconds != 570 || got[1].DurationSeconds != 30 {
		t.Fatalf("reports=%+v", got)
	}
	calls, _ := os.ReadFile(log)
	if string(calls) != "0:9600000\n9120000:480000\n" {
		t.Fatalf("calls=%q", calls)
	}
}
func TestSupervisorRejectsReports(t *testing.T) {
	for _, mode := range []string{"malformed", "trailing", "oversized", "wrong"} {
		t.Run(mode, func(t *testing.T) {
			s, audio := supervisorFor(t, sampleRate*2, mode)
			if _, err := s.Run(context.Background(), audio); err == nil {
				t.Fatal("accepted report")
			}
		})
	}
}
func TestSupervisorCancelsHungGroup(t *testing.T) {
	s, audio := supervisorFor(t, sampleRate*2, "hang")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := s.Run(ctx, audio)
	if err == nil || !strings.Contains(err.Error(), "deadline exceeded") || time.Since(started) > 3*time.Second {
		t.Fatalf("err=%v elapsed=%v", err, time.Since(started))
	}
}
