package livetranscript

import "testing"

func TestDecodeEventAcceptsSwiftContract(t *testing.T) {
	cases := []struct {
		line string
		kind EventKind
	}{
		{`{"type":"audio_chunk","source":"mic","path":"/tmp/mic.wav","start":0,"end":305,"canonicalStart":0,"canonicalEnd":300}`, EventChunk},
		{`{"type":"audio_chunk_source_complete","source":"mic","count":1,"canonicalEnd":300}`, EventSourceComplete},
		{`{"type":"audio_chunk_stream_complete","sources":["mic","system"]}`, EventStreamComplete},
	}
	for _, test := range cases {
		event, matched, err := DecodeEvent([]byte(test.line))
		if err != nil || !matched || event.Kind != test.kind {
			t.Fatalf("DecodeEvent(%s) = %+v, %v, %v", test.line, event, matched, err)
		}
	}
}

func TestDecodeEventRejectsInvalidContractFacts(t *testing.T) {
	cases := []string{
		`{"type":"audio_chunk","source":"mic","path":"x","start":-1,"end":305,"canonicalStart":0,"canonicalEnd":300}`,
		`{"type":"audio_chunk_source_complete","source":"unknown","count":1,"canonicalEnd":300}`,
		`{"type":"audio_chunk_stream_complete","sources":["mic","mic"]}`,
	}
	for _, input := range cases {
		_, matched, err := DecodeEvent([]byte(input))
		if !matched || err == nil {
			t.Fatalf("DecodeEvent(%s) matched=%v error=%v", input, matched, err)
		}
	}
}
