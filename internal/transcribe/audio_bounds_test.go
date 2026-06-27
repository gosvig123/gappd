package transcribe

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

const testSampleRate = 1000

func TestActiveWhisperWindowsSplitSpeechIslands(t *testing.T) {
	path := writeTestWAV(t, silentSamples(5000), toneSamples(1000, 1000), silentSamples(6000), toneSamples(4000, 1000), silentSamples(1000))

	got, ok := activeWhisperWindows(path)

	if !ok {
		t.Fatal("activeWhisperWindows() ok=false, want true")
	}
	assertBounds(t, got, []whisperBounds{{offsetMS: 12000, durationMS: 4000}})
}

func TestActiveWhisperWindowsSkipsSilentFile(t *testing.T) {
	path := writeTestWAV(t, silentSamples(15000))

	_, ok := activeWhisperWindows(path)

	if ok {
		t.Fatal("activeWhisperWindows() ok=true, want false")
	}
}

func assertBounds(t *testing.T, got, want []whisperBounds) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("len(bounds) = %d, want %d: %#v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("bounds[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func writeTestWAV(t *testing.T, chunks ...[]int16) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "audio.wav")
	data := mergeSamples(chunks...)
	if err := os.WriteFile(path, wavBytes(data), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return path
}

func mergeSamples(chunks ...[]int16) []int16 {
	var out []int16
	for _, chunk := range chunks {
		out = append(out, chunk...)
	}
	return out
}

func silentSamples(count int) []int16 {
	return make([]int16, count)
}

func toneSamples(count int, value int16) []int16 {
	out := make([]int16, count)
	for i := range out {
		out[i] = value
	}
	return out
}

func wavBytes(samples []int16) []byte {
	data := make([]byte, wavHeaderSize+len(samples)*2)
	copy(data[0:4], "RIFF")
	copy(data[8:12], "WAVE")
	copy(data[12:16], "fmt ")
	copy(data[36:40], "data")
	binary.LittleEndian.PutUint32(data[4:8], uint32(len(data)-8))
	binary.LittleEndian.PutUint32(data[16:20], 16)
	binary.LittleEndian.PutUint16(data[20:22], 1)
	binary.LittleEndian.PutUint16(data[22:24], 1)
	binary.LittleEndian.PutUint32(data[24:28], testSampleRate)
	binary.LittleEndian.PutUint32(data[28:32], testSampleRate*2)
	binary.LittleEndian.PutUint16(data[32:34], 2)
	binary.LittleEndian.PutUint16(data[34:36], 16)
	binary.LittleEndian.PutUint32(data[40:44], uint32(len(samples)*2))
	writeSamples(data[wavHeaderSize:], samples)
	return data
}

func writeSamples(data []byte, samples []int16) {
	for i, sample := range samples {
		binary.LittleEndian.PutUint16(data[i*2:], uint16(sample))
	}
}
