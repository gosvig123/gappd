package ai

import (
	"strings"
	"unicode/utf8"
)

const (
	// localTranscriptChunkChars fits the managed local model, which reads short
	// chunks best. A long Meeting is many chunks; there is no chunk limit.
	localTranscriptChunkChars = 6000
	// agentTranscriptChunkChars is about 90 minutes of talk. A longer chunk
	// makes one extraction cover too much of the Meeting.
	agentTranscriptChunkChars = 100_000
	// agentPromptReserveTokens covers the agent CLI's own instructions, the
	// extraction prompt, and its answer.
	agentPromptReserveTokens = 24_000
	// minCharsPerToken is low for non-English speech, so a chunk never
	// overflows a model's context.
	minCharsPerToken  = 3
	chunkOverlapLines = 6
)

// agentChunkChars sizes chunks for an agent model. A chunk uses at most half
// of the context left after the reserve. An unknown context (0) gets the
// agent default, because every hosted agent model reads more than it.
func agentChunkChars(contextTokens int) int {
	if contextTokens <= 0 {
		return agentTranscriptChunkChars
	}
	fit := (contextTokens - agentPromptReserveTokens) / 2 * minCharsPerToken
	return min(max(fit, localTranscriptChunkChars), agentTranscriptChunkChars)
}

func transcriptChunks(transcript string, maxChars int) []string {
	if len(transcript) <= maxChars {
		return []string{transcript}
	}
	lines := splitOversizedLines(strings.SplitAfter(transcript, "\n"), maxChars)
	return buildTranscriptChunks(lines, maxChars)
}

func splitOversizedLines(lines []string, maxChars int) []string {
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		out = appendLineParts(out, line, maxChars)
	}
	return out
}

func appendLineParts(out []string, line string, maxChars int) []string {
	for len(line) > maxChars {
		cut := runeSafeCut(line, maxChars)
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

func buildTranscriptChunks(lines []string, maxChars int) []string {
	var chunks []string
	current := make([]string, 0, chunkOverlapLines+1)
	currentLen := 0
	for _, line := range lines {
		if currentLen > 0 && currentLen+len(line) > maxChars {
			chunks = append(chunks, strings.Join(current, ""))
			current, currentLen = nextChunkSeed(current, line, maxChars)
		}
		current = append(current, line)
		currentLen += len(line)
	}
	return appendFinalChunk(chunks, current)
}

func nextChunkSeed(current []string, line string, maxChars int) ([]string, int) {
	seed := overlapLines(current)
	seedLen := linesLen(seed)
	if seedLen+len(line) > maxChars {
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
