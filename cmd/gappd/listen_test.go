package main

import (
	"reflect"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/meetingprocessing"
)

func TestDrainListenPipelineContinuesAfterTerminalDiarization(t *testing.T) {
	for _, test := range []struct {
		name   string
		result meetingprocessing.DrainResult
	}{
		{name: "completed", result: meetingprocessing.DrainResult{Completed: 1}},
		{name: "not applicable", result: meetingprocessing.DrainResult{Completed: 1}},
		{name: "degraded", result: meetingprocessing.DrainResult{Failed: 1}},
	} {
		t.Run(test.name, func(t *testing.T) {
			var calls []meetingprocessing.Capability
			err := drainListenPipeline(func(capability meetingprocessing.Capability) (meetingprocessing.DrainResult, error) {
				calls = append(calls, capability)
				result := meetingprocessing.DrainResult{Capability: capability, Completed: 1}
				if capability == meetingprocessing.CapabilityDiarization {
					result = test.result
					result.Capability = capability
				}
				return result, nil
			})
			if err != nil {
				t.Fatalf("drainListenPipeline() error = %v", err)
			}
			want := []meetingprocessing.Capability{
				meetingprocessing.CapabilityTranscription,
				meetingprocessing.CapabilityDiarization,
				meetingprocessing.CapabilitySummarization,
			}
			if !reflect.DeepEqual(calls, want) {
				t.Fatalf("drain calls = %v, want %v", calls, want)
			}
		})
	}
}

func TestDrainListenPipelineStopsAfterRequeuedDiarization(t *testing.T) {
	var calls []meetingprocessing.Capability
	err := drainListenPipeline(func(capability meetingprocessing.Capability) (meetingprocessing.DrainResult, error) {
		calls = append(calls, capability)
		result := meetingprocessing.DrainResult{Capability: capability, Completed: 1}
		if capability == meetingprocessing.CapabilityDiarization {
			result.Completed = 0
			result.Requeued = 1
		}
		return result, nil
	})
	if err == nil || !strings.Contains(err.Error(), "diarization processing remains pending") {
		t.Fatalf("drainListenPipeline() error = %v, want diarization pending error", err)
	}
	want := []meetingprocessing.Capability{
		meetingprocessing.CapabilityTranscription,
		meetingprocessing.CapabilityDiarization,
	}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("drain calls = %v, want %v", calls, want)
	}
}
