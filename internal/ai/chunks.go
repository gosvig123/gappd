package ai

import (
	"strings"
	"unicode/utf8"
)

const (
	maxTranscriptChunkChars = 12000
	maxTranscriptChunks     = 24
	chunkOverlapLines       = 6
)

func transcriptChunks(transcript string) []string {
	if len(transcript) <= maxTranscriptChunkChars {
		return []string{transcript}
	}
	lines := splitOversizedLines(strings.SplitAfter(transcript, "\n"))
	return buildTranscriptChunks(lines)
}

func splitOversizedLines(lines []string) []string {
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		out = appendLineParts(out, line)
	}
	return out
}

func appendLineParts(out []string, line string) []string {
	for len(line) > maxTranscriptChunkChars {
		cut := runeSafeCut(line, maxTranscriptChunkChars)
		out = append(out, line[:cut])
		line = line[cut:]
	}
	if line != "" {
		out = append(out, line)
	}
	return out
}

func runeSafeCut(value string, limit int) int {
	cut := 0
	for idx := range value {
		if idx > limit {
			break
		}
		cut = idx
	}
	if cut == 0 {
		_, size := utf8.DecodeRuneInString(value)
		return size
	}
	return cut
}

func buildTranscriptChunks(lines []string) []string {
	var chunks []string
	current := make([]string, 0, chunkOverlapLines+1)
	currentLen := 0
	for _, line := range lines {
		if currentLen > 0 && currentLen+len(line) > maxTranscriptChunkChars {
			chunks = append(chunks, strings.Join(current, ""))
			current, currentLen = nextChunkSeed(current, line)
		}
		current = append(current, line)
		currentLen += len(line)
	}
	return appendFinalChunk(chunks, current)
}

func nextChunkSeed(current []string, line string) ([]string, int) {
	seed := overlapLines(current)
	seedLen := linesLen(seed)
	if seedLen+len(line) > maxTranscriptChunkChars {
		return nil, 0
	}
	return seed, seedLen
}

func overlapLines(lines []string) []string {
	if len(lines) <= chunkOverlapLines {
		return append([]string(nil), lines...)
	}
	return append([]string(nil), lines[len(lines)-chunkOverlapLines:]...)
}

func linesLen(lines []string) int {
	total := 0
	for _, line := range lines {
		total += len(line)
	}
	return total
}

func appendFinalChunk(chunks []string, current []string) []string {
	if len(current) == 0 {
		return chunks
	}
	return append(chunks, strings.Join(current, ""))
}
