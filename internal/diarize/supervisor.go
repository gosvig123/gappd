package diarize

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/processgroup"
)

const (
	sampleRate       = int64(16000)
	windowFrames     = 600 * sampleRate
	windowStepFrames = 570 * sampleRate
	// maxReportBytes caps compact window reports at 3 MiB.
	maxReportBytes = 3 << 20
	maxStderrBytes = 4 << 10
	Engine         = "fluidaudio-offline-vbx"
	EngineRevision = "300165b240c45375add402265f62410b6df33cf1"
)

// Supervisor validates a retained recording and runs one isolated helper per window.
type Supervisor struct {
	HelperPath, ModelsDirectory string
}

type frameRange struct{ start, count int64 }
type helperReport struct {
	SchemaVersion       int             `json:"schemaVersion"`
	Engine              string          `json:"engine"`
	EngineRevision      string          `json:"engineRevision"`
	RequestedStartFrame int64           `json:"requestedStartFrame"`
	RequestedFrameCount int64           `json:"requestedFrameCount"`
	Clusters            []helperCluster `json:"clusters"`
	Spans               []helperSpan    `json:"spans"`
}
type helperCluster struct {
	ID       string    `json:"localClusterID"`
	Centroid []float64 `json:"centroid"`
}
type helperSpan struct {
	ID       string  `json:"localClusterID"`
	Start    float64 `json:"startSeconds"`
	End      float64 `json:"endSeconds"`
	Quality  float64 `json:"qualityScore"`
	Identity float64 `json:"identityScore"`
}

func (s Supervisor) Run(ctx context.Context, audioPath string) ([]WindowReport, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("diarize: %w", err)
	}
	frames, err := wavFrames(audioPath)
	if err != nil {
		return nil, err
	}
	if s.HelperPath == "" || s.ModelsDirectory == "" {
		return nil, errors.New("diarize: helper configuration unavailable")
	}
	ranges := frameRanges(frames)
	attempt, cancel := context.WithTimeout(ctx, attemptTimeout(frames))
	defer cancel()
	out, dimension := make([]WindowReport, 0, len(ranges)), 0
	for i, r := range ranges {
		data, runErr := s.run(attempt, audioPath, r)
		if attemptErr := attempt.Err(); attemptErr != nil {
			return nil, fmt.Errorf("diarize window %d: %w", i, attemptErr)
		}
		if runErr != "" {
			return nil, fmt.Errorf("diarize window %d: %s", i, runErr)
		}
		report, err := decodeReport(data, r, &dimension)
		if err != nil {
			return nil, fmt.Errorf("diarize window %d: invalid helper report", i)
		}
		out = append(out, report)
	}
	return out, nil
}

func wavFrames(path string) (int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, errors.New("diarize: invalid audio")
	}
	defer f.Close()
	var h [44]byte
	info, statErr := f.Stat()
	_, readErr := io.ReadFull(f, h[:])
	u16, u32 := func(at int) uint16 { return binary.LittleEndian.Uint16(h[at:]) }, func(at int) uint32 { return binary.LittleEndian.Uint32(h[at:]) }
	data := int64(u32(40))
	if statErr != nil || readErr != nil || string(h[0:4]) != "RIFF" || string(h[8:16]) != "WAVEfmt " || u32(16) != 16 ||
		u16(20) != 1 || u16(22) != 1 || u32(24) != 16000 || u32(28) != 32000 || u16(32) != 2 || u16(34) != 16 ||
		string(h[36:40]) != "data" || data == 0 || data%2 != 0 || info.Size() != 44+data || int64(u32(4)) != info.Size()-8 {
		return 0, errors.New("diarize: invalid audio")
	}
	return data / 2, nil
}

func attemptTimeout(frames int64) time.Duration {
	return min(150*time.Second, 30*time.Second+time.Duration(frames)*time.Second/time.Duration(sampleRate*60))
}

func frameRanges(frames int64) []frameRange {
	var out []frameRange
	for start := int64(0); start < frames; start += windowStepFrames {
		count := frames - start
		if count > windowFrames {
			count = windowFrames
		}
		out = append(out, frameRange{start, count})
	}
	return out
}

type limitedBuffer struct {
	bytes.Buffer
	limit    int
	overflow bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	n, left := len(p), b.limit-b.Len()
	if left > 0 {
		_, _ = b.Buffer.Write(p[:min(left, n)])
	}
	if n > left {
		b.overflow = true
	}
	return n, nil
}

func (s Supervisor) run(ctx context.Context, audio string, r frameRange) ([]byte, string) {
	if ctx.Err() != nil {
		return nil, "helper canceled"
	}
	cmd := exec.Command(s.HelperPath, audio, strconv.FormatInt(r.start, 10), strconv.FormatInt(r.count, 10), s.ModelsDirectory)
	stdout, stderr := &limitedBuffer{limit: maxReportBytes}, &limitedBuffer{limit: maxStderrBytes}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	processgroup.Configure(cmd)
	if cmd.Start() != nil {
		return nil, "helper start failed"
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if stdout.overflow || stderr.overflow {
			return nil, "helper output too large"
		}
		if err != nil {
			return nil, "helper failed"
		}
		return stdout.Bytes(), ""
	case <-ctx.Done():
		_ = processgroup.Signal(cmd, syscall.SIGTERM)
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-done:
		case <-timer.C:
			_ = processgroup.Signal(cmd, syscall.SIGKILL)
			<-done
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		// Leader may exit before descendants; kill remaining group members.
		_ = processgroup.Signal(cmd, syscall.SIGKILL)
		return nil, "helper canceled"
	}
}

func decodeReport(data []byte, r frameRange, dimension *int) (WindowReport, error) {
	var raw helperReport
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&raw) != nil {
		return WindowReport{}, errors.New("json")
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF || raw.SchemaVersion != 1 || raw.Engine != Engine || raw.EngineRevision != EngineRevision ||
		raw.RequestedStartFrame != r.start || raw.RequestedFrameCount != r.count {
		return WindowReport{}, errors.New("metadata")
	}
	out := WindowReport{StartSeconds: float64(r.start) / float64(sampleRate), DurationSeconds: float64(r.count) / float64(sampleRate)}
	ids := make(map[string]bool, len(raw.Clusters))
	for _, c := range raw.Clusters {
		if c.ID == "" || ids[c.ID] || len(c.Centroid) == 0 || !finite(c.Centroid...) {
			return WindowReport{}, errors.New("centroid")
		}
		if *dimension == 0 {
			*dimension = len(c.Centroid)
		}
		if len(c.Centroid) != *dimension {
			return WindowReport{}, errors.New("centroid")
		}
		ids[c.ID] = true
		out.Clusters = append(out.Clusters, LocalCluster{c.ID, c.Centroid})
	}
	last, duration := -1.0, out.DurationSeconds
	for _, span := range raw.Spans {
		if !ids[span.ID] || !finite(span.Start, span.End, span.Quality, span.Identity) || span.Start < 0 || span.End <= span.Start ||
			span.End > duration || span.Start < last || span.Quality < 0 || span.Quality > 1 || span.Identity < 0 || span.Identity > 1 {
			return WindowReport{}, errors.New("span")
		}
		last = span.Start
		out.Spans = append(out.Spans, LocalSpan{span.ID, span.Start, span.End, span.Quality, span.Identity})
	}
	return out, nil
}
