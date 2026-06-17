package recording

import (
	"os"
	"path/filepath"
	"sort"

	"github.com/gappd-dev/gappd/internal/db"
)

func pendingLiveChunks(recorder audioRecorder, seen map[string]bool) ([]liveChunk, error) {
	var chunks []liveChunk
	for _, src := range audioSources(recorder) {
		items, err := sourceLiveChunks(src, seen)
		if err != nil {
			return nil, err
		}
		chunks = append(chunks, items...)
	}
	sort.Slice(chunks, func(i, j int) bool { return liveChunkLess(chunks[i], chunks[j]) })
	return chunks, nil
}

func liveChunkLess(a, b liveChunk) bool {
	if a.start != b.start {
		return a.start < b.start
	}
	return a.speaker < b.speaker
}

func sourceLiveChunks(src audioSource, seen map[string]bool) ([]liveChunk, error) {
	files, err := filepath.Glob(filepath.Join(chunkDir(src.path), chunkPrefix(src.path)+"-*"+chunkExt))
	if err != nil || len(files) < 2 {
		return nil, err
	}
	return closedLiveChunks(files, src, seen), nil
}

func closedLiveChunks(files []string, src audioSource, seen map[string]bool) []liveChunk {
	var chunks []liveChunk
	start := 0.0
	for _, file := range files[:len(files)-1] {
		if !seen[file] && usableWAV(file) {
			chunks = append(chunks, liveChunk{path: file, speaker: src.speaker, start: start})
		}
		start += liveChunkDurationFromFile(file)
	}
	return chunks
}

func usableWAV(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Size() > minWAVSize
}

func pruneLiveTail(segments []db.Segment, chunk liveChunk) []db.Segment {
	out := segments[:0]
	for _, segment := range segments {
		if segment.Speaker == chunk.speaker && segment.End > chunk.start {
			continue
		}
		out = append(out, segment)
	}
	return out
}

func offsetSegments(segments []db.Segment, start float64) {
	for i := range segments {
		segments[i].Start += start
		segments[i].End += start
	}
}
