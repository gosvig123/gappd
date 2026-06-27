package transcribe

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
)

const (
	wavHeaderSize         = 44
	pcm16BitsPerSample    = 16
	activeWindowMS        = 500
	activePrePaddingMS    = 0
	activePostPaddingMS   = 0
	activeMinTrimMS       = 10000
	activeMinSpeechMS     = 2000
	activeClusterGapMS    = 5000
	activeClusterMinMS    = 3000
	activeMinThreshold    = 50
	activeMaxThreshold    = 300
	activeNoiseMultiplier = 8
	activePeakDivisor     = 16
)

type whisperBounds struct {
	offsetMS   int
	durationMS int
}

type wavInfo struct {
	sampleRate    int
	channels      int
	bitsPerSample int
	dataBytes     int
}

func activeWhisperWindows(path string) ([]whisperBounds, bool) {
	file, info, err := openPCM16WAV(path)
	if err != nil {
		return nil, false
	}
	defer file.Close()
	windows, err := scanRMSWindows(file, info.bytesPerWindow())
	if err != nil || len(windows) == 0 {
		return nil, false
	}
	return trimWindows(windows, info.durationMS())
}

func openPCM16WAV(path string) (*os.File, wavInfo, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, wavInfo{}, err
	}
	info, err := readWAVHeader(file)
	if err != nil {
		file.Close()
		return nil, wavInfo{}, err
	}
	return file, info, nil
}

func readWAVHeader(r io.Reader) (wavInfo, error) {
	header := make([]byte, wavHeaderSize)
	if _, err := io.ReadFull(r, header); err != nil {
		return wavInfo{}, err
	}
	if string(header[0:4]) != "RIFF" || string(header[8:12]) != "WAVE" || string(header[36:40]) != "data" {
		return wavInfo{}, fmt.Errorf("unsupported wav header")
	}
	return wavInfo{sampleRate: u32(header[24:28]), channels: u16(header[22:24]), bitsPerSample: u16(header[34:36]), dataBytes: u32(header[40:44])}, nil
}

func u16(data []byte) int {
	return int(binary.LittleEndian.Uint16(data))
}

func u32(data []byte) int {
	return int(binary.LittleEndian.Uint32(data))
}

func (i wavInfo) bytesPerWindow() int {
	return i.sampleRate * i.channels * (i.bitsPerSample / 8) * activeWindowMS / 1000
}

func (i wavInfo) durationMS() int {
	bytesPerSecond := i.sampleRate * i.channels * (i.bitsPerSample / 8)
	return i.dataBytes * 1000 / bytesPerSecond
}

func scanRMSWindows(r io.Reader, frameBytes int) ([]int, error) {
	windows := []int{}
	buffer := make([]byte, frameBytes)
	for {
		n, err := io.ReadFull(r, buffer)
		if err == io.ErrUnexpectedEOF || err == io.EOF {
			return appendLastWindow(windows, buffer[:n]), nil
		}
		if err != nil {
			return nil, err
		}
		windows = append(windows, pcm16RMS(buffer))
	}
}

func appendLastWindow(windows []int, data []byte) []int {
	if len(data) == 0 {
		return windows
	}
	return append(windows, pcm16RMS(data))
}

func pcm16RMS(data []byte) int {
	if len(data) < 2 {
		return 0
	}
	var sum float64
	for i := 0; i+1 < len(data); i += 2 {
		sample := int16(binary.LittleEndian.Uint16(data[i : i+2]))
		sum += float64(sample) * float64(sample)
	}
	return int(math.Sqrt(sum / float64(len(data)/2)))
}

func trimWindows(windows []int, durationMS int) ([]whisperBounds, bool) {
	clusters := boundedClusters(windows, durationMS)
	if len(clusters) == 0 || !worthTrimming(clusters, durationMS) {
		return nil, false
	}
	bounds := make([]whisperBounds, 0, len(clusters))
	for _, cluster := range clusters {
		bounds = appendBound(bounds, clusterBound(cluster, durationMS))
	}
	return bounds, len(bounds) > 0
}

func boundedClusters(windows []int, durationMS int) []activeCluster {
	threshold := activeThreshold(windows)
	clusters := activeClusters(windows, threshold)
	if activeDuration(clusters) < activeMinSpeechMS || durationMS <= 0 {
		return nil
	}
	return clusters
}

func worthTrimming(clusters []activeCluster, durationMS int) bool {
	first := clusters[0].first * activeWindowMS
	last := (clusters[len(clusters)-1].last + 1) * activeWindowMS
	return first >= activeMinTrimMS || durationMS-last >= activeMinTrimMS
}

func clusterBound(cluster activeCluster, durationMS int) whisperBounds {
	start := max(0, cluster.first*activeWindowMS-activePrePaddingMS)
	end := min(durationMS, (cluster.last+1)*activeWindowMS+activePostPaddingMS)
	return whisperBounds{offsetMS: start, durationMS: end - start}
}

func appendBound(bounds []whisperBounds, next whisperBounds) []whisperBounds {
	last := len(bounds) - 1
	if last >= 0 && boundEnd(bounds[last]) >= next.offsetMS {
		bounds[last].durationMS = max(boundEnd(bounds[last]), boundEnd(next)) - bounds[last].offsetMS
		return bounds
	}
	return append(bounds, next)
}

func boundEnd(bound whisperBounds) int {
	return bound.offsetMS + bound.durationMS
}

func activeThreshold(windows []int) int {
	peak := maxWindow(windows)
	threshold := max(activeMinThreshold, max(medianWindow(windows)*activeNoiseMultiplier, peak/activePeakDivisor))
	return min(activeMaxThreshold, threshold)
}

func medianWindow(windows []int) int {
	copy := append([]int(nil), windows...)
	sort.Ints(copy)
	return copy[len(copy)/2]
}

func maxWindow(windows []int) int {
	maxValue := 0
	for _, value := range windows {
		maxValue = max(maxValue, value)
	}
	return maxValue
}
