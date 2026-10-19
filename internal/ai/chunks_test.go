package ai

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTranscriptChunksSplitOversizedUTF8Line(t *testing.T) {
	transcript := strings.Repeat("å", localTranscriptChunkChars)

	for _, chunk := range transcriptChunks(transcript, localTranscriptChunkChars) {
		if !utf8.ValidString(chunk) {
			t.Fatalf("chunk contains invalid UTF-8")
		}
	}
}

func TestAgentChunkCharsFollowTheModelContext(t *testing.T) {
	cases := map[int]int{
		0:         agentTranscriptChunkChars,
		1_000_000: agentTranscriptChunkChars,
		64_000:    60_000,
		32_000:    12_000,
		24_000:    localTranscriptChunkChars,
	}
	for contextTokens, want := range cases {
		if got := agentChunkChars(contextTokens); got != want {
			t.Errorf("agentChunkChars(%d) = %d, want %d", contextTokens, got, want)
		}
	}
}

func TestPipelineSizesChunksToTheProvider(t *testing.T) {
	_, local := newFakePipeline()
	agent, err := NewAgentProvider("pi_agent", "/bin/pi", AgentSelection{Model: "openai-codex/gpt-5.5", ContextTokens: 64_000})
	if err != nil {
		t.Fatal(err)
	}
	if got := local.chunkChars(); got != localTranscriptChunkChars {
		t.Errorf("local chunk chars = %d, want %d", got, localTranscriptChunkChars)
	}
	if got := NewPipeline(agent, 0.3).chunkChars(); got != 60_000 {
		t.Errorf("agent chunk chars = %d, want 60000", got)
	}
}
