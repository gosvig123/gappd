package meetingprocessing

import (
	"strings"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/diarize"
)

func diarizationInput(segments []db.Segment) diarize.Input {
	input := diarize.Input{}
	indexes := make(map[[2]float64]int)
	for _, segment := range segments {
		if segment.SpeakerSource == nil {
			continue
		}
		if *segment.SpeakerSource == db.SegmentSourceSystem {
			input.Phrases = append(input.Phrases, diarize.Phrase{SegmentID: segment.ID, StartSeconds: segment.Start, EndSeconds: segment.End})
			appendProjectionGroup(&input, indexes, segment)
		} else if *segment.SpeakerSource == db.SegmentSourceMicrophone && strings.TrimSpace(segment.Text) != "" {
			input.HasMicrophoneSpeech = true
		}
	}
	return input
}

func appendProjectionGroup(input *diarize.Input, indexes map[[2]float64]int, segment db.Segment) {
	if segment.SpeakerGroupStart == nil || segment.SpeakerGroupEnd == nil || *segment.SpeakerGroupEnd <= *segment.SpeakerGroupStart {
		return
	}
	key := [2]float64{*segment.SpeakerGroupStart, *segment.SpeakerGroupEnd}
	index, found := indexes[key]
	if !found {
		index = len(input.ProjectionGroups)
		indexes[key] = index
		input.ProjectionGroups = append(input.ProjectionGroups, diarize.ProjectionGroup{Phrase: diarize.Phrase{SegmentID: segment.ID, StartSeconds: key[0], EndSeconds: key[1]}})
	}
	input.ProjectionGroups[index].SegmentIDs = append(input.ProjectionGroups[index].SegmentIDs, segment.ID)
}

func projectionCommit(claim *db.ProcessingClaim, output diarize.Output, at time.Time) db.SpeakerProjectionCommit {
	return db.SpeakerProjectionCommit{MeetingID: claim.Meeting.ID, ClaimToken: claim.Token,
		CapturedTranscriptRevision: claim.Meeting.TranscriptRevision, Assignments: output.Assignments,
		Embeddings: output.Embeddings, ProvenanceJSON: projectionProvenance(output), CompletedAt: at}
}
