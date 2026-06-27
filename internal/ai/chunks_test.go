package ai

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTranscriptChunksSplitOversizedUTF8Line(t *testing.T) {
	transcript := strings.Repeat("å", maxTranscriptChunkChars)

	for _, chunk := range transcriptChunks(transcript) {
		if !utf8.ValidString(chunk) {
			t.Fatalf("chunk contains invalid UTF-8")
		}
	}
}
