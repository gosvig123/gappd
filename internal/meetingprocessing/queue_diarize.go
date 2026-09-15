package meetingprocessing

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/diarize"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

func (s Service) diarizeClaim(ctx context.Context, store *db.DB, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim, result *DrainResult) error {
	started, err := lifecycle.StartDiarization(context.WithoutCancel(ctx), claim.Meeting.ID, claim.Token)
	if err != nil {
		return s.finalizeClaimError(context.WithoutCancel(ctx), lifecycle, claim, result, err)
	}
	if !started.Applied {
		return nil
	}
	return s.runDiarizeClaim(ctx, store, lifecycle, claim, result)
}

func (s Service) runDiarizeClaim(ctx context.Context, store *db.DB, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim, result *DrainResult) error {
	segments, err := store.GetSegments(claim.Meeting.ID)
	if err != nil {
		return s.failDiarization(ctx, lifecycle, claim, result, err)
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return s.interruptDiarization(ctx, lifecycle, claim, result)
	}
	input := diarizationInput(segments)
	if len(input.Phrases) == 0 {
		return s.noDiarizationSpeech(ctx, lifecycle, claim, result)
	}
	output, err := s.diarizeMeeting(ctx, claim, input)
	if err != nil {
		return s.finishDiarizationResult(ctx, lifecycle, claim, result, false, err)
	}
	_, applied, err := store.CommitSpeakerProjection(ctx, projectionCommit(claim, output, s.now()))
	return s.finishDiarizationResult(ctx, lifecycle, claim, result, applied, err)
}

func (s Service) diarizeMeeting(ctx context.Context, claim *db.ProcessingClaim, input diarize.Input) (diarize.Output, error) {
	if claim.Meeting.AudioPath == nil || strings.TrimSpace(*claim.Meeting.AudioPath) == "" {
		return diarize.Output{}, errors.New("missing audio")
	}
	windows, err := s.runDiarization(ctx, audioartifact.New(*claim.Meeting.AudioPath).SystemPath())
	if err != nil {
		return diarize.Output{}, err
	}
	input.Windows = windows
	return diarize.Transform(input)
}

func (s Service) noDiarizationSpeech(ctx context.Context, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim, result *DrainResult) error {
	finished, err := lifecycle.MarkDiarizationNotApplicable(context.WithoutCancel(ctx), claim.Meeting.ID, claim.Token, s.now())
	if err == nil && finished.Applied {
		result.Completed++
	}
	return err
}

func (s Service) finishDiarizationResult(ctx context.Context, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim, result *DrainResult, applied bool, err error) error {
	if errors.Is(err, context.Canceled) {
		return s.interruptDiarization(ctx, lifecycle, claim, result)
	}
	if err != nil {
		return s.failDiarization(ctx, lifecycle, claim, result, err)
	}
	if !applied {
		return s.interruptDiarization(ctx, lifecycle, claim, result)
	}
	result.Completed++
	return nil
}

func projectionProvenance(output diarize.Output) string {
	provenance, _ := json.Marshal(struct {
		Engine         string  `json:"engine"`
		EngineRevision string  `json:"engineRevision"`
		Semantics      string  `json:"semantics"`
		SpeakerCount   int     `json:"speakerCount"`
		Coverage       float64 `json:"coverage"`
	}{diarize.Engine, diarize.EngineRevision, diarize.ProjectionSemantics, output.SpeakerCount, output.Coverage})
	return string(provenance)
}
