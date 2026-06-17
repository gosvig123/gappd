package recording

import (
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gappd-dev/gappd/internal/transcribe"
)

type liveWindow struct {
	path    string
	start   float64
	cutoff  float64
	cleanup func()
}

func liveChunkWindow(chunk liveChunk) (liveWindow, error) {
	previous := previousLiveChunk(chunk.path)
	if previous == "" || !usableWAV(previous) {
		return liveWindow{path: chunk.path, start: chunk.start, cleanup: noop}, nil
	}
	path, err := joinLiveChunks(previous, chunk.path)
	if err != nil {
		return liveWindow{}, err
	}
	return liveWindow{path: path, start: chunk.start - liveChunkDuration.Seconds(), cutoff: liveChunkDuration.Seconds(), cleanup: func() { _ = os.Remove(path) }}, nil
}

func noop() {}

func liveWindowSegments(segments []transcribe.Segment, cutoff float64) []transcribe.Segment {
	out := segments[:0]
	for _, segment := range segments {
		if segment.End > cutoff {
			out = append(out, segment)
		}
	}
	return out
}

func previousLiveChunk(path string) string {
	prefix := liveChunkPrefix(path)
	index := chunkIndex(path, prefix)
	if index == 0 {
		return ""
	}
	name := fmt.Sprintf("%s-%06d%s", prefix, index-1, chunkExt)
	return filepath.Join(filepath.Dir(path), name)
}

func chunkIndex(path, prefix string) int {
	name := strings.TrimSuffix(filepath.Base(path), chunkExt)
	index, _ := strconv.Atoi(strings.TrimPrefix(name, prefix+"-"))
	return index
}

func liveChunkPrefix(path string) string {
	name := strings.TrimSuffix(filepath.Base(path), chunkExt)
	if index := strings.LastIndex(name, "-"); index > 0 {
		return name[:index]
	}
	return name
}

func joinLiveChunks(previous, current string) (string, error) {
	file, err := os.CreateTemp("", "gappd-live-window-*.wav")
	if err != nil {
		return "", err
	}
	defer file.Close()
	if err := writeLiveWindow(file, []string{previous, current}); err != nil {
		_ = os.Remove(file.Name())
		return "", err
	}
	return file.Name(), nil
}

func writeLiveWindow(file *os.File, chunks []string) error {
	if _, err := file.Write(make([]byte, minWAVSize)); err != nil {
		return err
	}
	size, err := copyLivePCM(file, chunks)
	if err != nil {
		return err
	}
	return writeLiveHeader(file, size)
}

func copyLivePCM(out *os.File, chunks []string) (int64, error) {
	var total int64
	for _, chunk := range chunks {
		size, err := appendLivePCM(out, chunk)
		if err != nil {
			return total, err
		}
		total += size
	}
	return total, nil
}

func appendLivePCM(out *os.File, path string) (int64, error) {
	in, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer in.Close()
	if _, err := in.Seek(minWAVSize, io.SeekStart); err != nil {
		return 0, err
	}
	return io.Copy(out, in)
}

func writeLiveHeader(file *os.File, dataSize int64) error {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	_, err := file.Write(liveWAVHeader(dataSize))
	return err
}

func liveWAVHeader(dataSize int64) []byte {
	header := make([]byte, minWAVSize)
	copy(header[0:4], "RIFF")
	binary.LittleEndian.PutUint32(header[4:8], uint32(dataSize+36))
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	binary.LittleEndian.PutUint32(header[16:20], 16)
	binary.LittleEndian.PutUint16(header[20:22], 1)
	binary.LittleEndian.PutUint16(header[22:24], 1)
	binary.LittleEndian.PutUint32(header[24:28], 16000)
	binary.LittleEndian.PutUint32(header[28:32], 32000)
	binary.LittleEndian.PutUint16(header[32:34], 2)
	binary.LittleEndian.PutUint16(header[34:36], 16)
	copy(header[36:40], "data")
	binary.LittleEndian.PutUint32(header[40:44], uint32(dataSize))
	return header
}
