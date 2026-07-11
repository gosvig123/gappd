package capture

import (
	"reflect"
	"testing"
)

func TestAppendChunkArgsForwardsOverlapWhenChunksEnabled(t *testing.T) {
	t.Setenv(captureChunkSecondsEnv, "300")
	t.Setenv(captureChunkOverlapEnv, "10")
	got := appendChunkArgs([]string{"capture"})
	want := []string{"capture", "--chunk-seconds", "300", "--chunk-overlap-seconds", "10"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("appendChunkArgs() = %v, want %v", got, want)
	}
}

func TestAppendChunkArgsIgnoresOverlapWhenChunksDisabled(t *testing.T) {
	t.Setenv(captureChunkSecondsEnv, "")
	t.Setenv(captureChunkOverlapEnv, "10")
	got := appendChunkArgs([]string{"capture"})
	if !reflect.DeepEqual(got, []string{"capture"}) {
		t.Fatalf("appendChunkArgs() = %v", got)
	}
}
