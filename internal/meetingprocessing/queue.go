package meetingprocessing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/diarize"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

const claimTTL = 5 * time.Minute

func (s Service) Drain(ctx context.Context, capability Capability) (DrainResult, error) {
	result := DrainResult{Capability: capability}
	store, ok := s.Store.(*db.DB)
	if !ok {
		return result, fmt.Errorf("processing drain requires sqlite store")
	}
	stage, err := capabilityStage(capability)
	if err != nil {
		return result, err
	}
	if err := s.drainClaims(ctx, store, stage, &result); err != nil {
		return result, err
	}
	return result, nil
}

func (s Service) drainClaims(ctx context.Context, store *db.DB, stage db.QueueStage, result *DrainResult) error {
	attempted := []string{}
	for {
		claim, err := store.ClaimNext(ctx, stage, s.now(), claimTTL, attempted)
		if err != nil {
			return err
		}
		if claim == nil {
			return nil
		}
		attempted = append(attempted, claim.Meeting.ID)
		result.Attempted++
		if err := s.runClaim(ctx, store, claim, result); err != nil {
			return err
		}
	}
}

func capabilityStage(capability Capability) (db.QueueStage, error) {
	switch capability {
	case CapabilityTranscription:
		return db.QueueStageTranscription, nil
	case CapabilityDiarization:
		return db.QueueStageDiarization, nil
	case CapabilitySummarization:
		return db.QueueStageSummarization, nil
	default:
		return "", fmt.Errorf("invalid processing capability %q", capability)
	}
}

func (s Service) runClaim(ctx context.Context, store *db.DB, claim *db.ProcessingClaim, result *DrainResult) error {
	lifecycle := meetinglifecycle.New(store)
	stopRenewal := s.maintainClaim(ctx, store, claim)
	defer stopRenewal()
	if claim.Stage == db.QueueStageDiarization {
		return s.diarizeClaim(ctx, store, lifecycle, claim, result)
	}
	if err := s.processClaim(ctx, lifecycle, claim); err != nil {
		return s.finalizeClaimError(ctx, lifecycle, claim, result, err)
	}
	result.Completed++
	return nil
}

func (s Service) diarizeClaim(ctx context.Context, store *db.DB, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim, result *DrainResult) error {
	started, err := lifecycle.StartDiarization(context.WithoutCancel(ctx), claim.Meeting.ID, claim.Token)
	if err != nil {
		return s.finalizeClaimError(context.WithoutCancel(ctx), lifecycle, claim, result, err)
	}
	if !started.Applied {
		return nil
	}
	segments, err := store.GetSegments(claim.Meeting.ID)
	if err != nil {
		return s.failDiarization(ctx, lifecycle, claim, result, err)
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return s.interruptDiarization(ctx, lifecycle, claim, result)
	}
	phrases, mic := []diarize.Phrase{}, false
	for _, segment := range segments {
		if segment.SpeakerSource == nil {
			continue
		}
		if *segment.SpeakerSource == db.SegmentSourceSystem {
			phrases = append(phrases, diarize.Phrase{SegmentID: segment.ID, StartSeconds: segment.Start, EndSeconds: segment.End})
		} else if *segment.SpeakerSource == db.SegmentSourceMicrophone && strings.TrimSpace(segment.Text) != "" {
			mic = true
		}
	}
	if len(phrases) == 0 {
		finished, finishErr := lifecycle.MarkDiarizationNotApplicable(context.WithoutCancel(ctx), claim.Meeting.ID, claim.Token, s.now())
		if finishErr == nil && finished.Applied {
			result.Completed++
		}
		return finishErr
	}
	if claim.Meeting.AudioPath == nil || strings.TrimSpace(*claim.Meeting.AudioPath) == "" {
		return s.failDiarization(ctx, lifecycle, claim, result, errors.New("missing audio"))
	}
	windows, runErr := s.runDiarization(ctx, audioartifact.New(*claim.Meeting.AudioPath).SystemPath())
	if runErr != nil {
		if errors.Is(runErr, context.Canceled) {
			return s.interruptDiarization(ctx, lifecycle, claim, result)
		}
		return s.failDiarization(ctx, lifecycle, claim, result, runErr)
	}
	output, transformErr := diarize.Transform(diarize.Input{Windows: windows, Phrases: phrases, HasMicrophoneSpeech: mic})
	if transformErr != nil {
		return s.failDiarization(ctx, lifecycle, claim, result, transformErr)
	}
	provenance, _ := json.Marshal(struct {
		Engine         string  `json:"engine"`
		EngineRevision string  `json:"engineRevision"`
		Semantics      string  `json:"semantics"`
		SpeakerCount   int     `json:"speakerCount"`
		Coverage       float64 `json:"coverage"`
	}{diarize.Engine, diarize.EngineRevision, "v1", output.SpeakerCount, output.Coverage})
	_, applied, err := store.CommitSpeakerProjection(ctx, db.SpeakerProjectionCommit{MeetingID: claim.Meeting.ID, ClaimToken: claim.Token,
		CapturedTranscriptRevision: claim.Meeting.TranscriptRevision, Assignments: output.Assignments, ProvenanceJSON: string(provenance), CompletedAt: s.now()})
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

func (s Service) interruptDiarization(ctx context.Context, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim, result *DrainResult) error {
	finished, err := lifecycle.InterruptDiarization(context.WithoutCancel(ctx), claim.Meeting.ID, claim.Token, s.now())
	if err == nil && finished.Applied {
		result.Requeued++
	}
	return err
}

func (s Service) failDiarization(ctx context.Context, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim, result *DrainResult, cause error) error {
	log.Printf("speaker labeling failed for meeting %s: %v", claim.Meeting.ID, cause)
	finished, err := lifecycle.DegradeDiarization(context.WithoutCancel(ctx), claim.Meeting.ID, claim.Token, errors.New("Speaker labeling failed"), s.now())
	if err == nil && finished.Applied {
		result.Failed++
	}
	return err
}

func (s Service) finalizeClaimError(ctx context.Context, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim, result *DrainResult, claimErr error) error {
	finalized, err := lifecycle.TransitionClaim(ctx, claim.Meeting.ID, claim.Token, s.failureTransition(claimErr, nil))
	if err != nil {
		return errors.Join(claimErr, fmt.Errorf("finalize processing claim: %w", err))
	}
	if !finalized.Applied {
		return nil
	}
	if category(claimErr) == ErrorTransient {
		result.Requeued++
	} else {
		result.Failed++
	}
	return nil
}

func (s Service) processClaim(ctx context.Context, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim) error {
	switch claim.Stage {
	case db.QueueStageTranscription:
		return s.transcribeClaim(ctx, lifecycle, claim)
	case db.QueueStageSummarization:
		return s.summarizeClaim(ctx, lifecycle, claim)
	default:
		return deterministic(fmt.Errorf("inconsistent meeting artifacts"))
	}
}

func (s Service) transcribeClaim(ctx context.Context, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim) error {
	if claim.Meeting.AudioPath == nil || *claim.Meeting.AudioPath == "" {
		return deterministic(ErrNoAudio)
	}
	segments, err := s.transcribeStreams(ctx, *claim.Meeting.AudioPath, claim.Meeting.Language, claim.Meeting.ID)
	if err != nil {
		return err
	}
	result, err := lifecycle.SaveClaimTranscript(ctx, claim.Meeting.ID, claim.Token, FormatTranscript(segments), segments, s.now())
	if err != nil {
		return err
	}
	if !result.Applied {
		return fmt.Errorf("transcription claim expired")
	}
	return nil
}

func (s Service) summarizeClaim(ctx context.Context, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim) error {
	if claim.Meeting.Transcript == nil || *claim.Meeting.Transcript == "" {
		return deterministic(ErrNoTranscript)
	}
	extraction, summary, err := s.notes().RunWithOptions(ctx, *claim.Meeting.Transcript, s.runOptions(&claim.Meeting, StoredRequest{}))
	if err != nil {
		return err
	}
	encoded, err := ai.EncodeExtraction(extraction)
	if err != nil {
		return deterministic(err)
	}
	completion := meetinglifecycle.Completion{Title: extraction.Title, Transcript: *claim.Meeting.Transcript,
		Summary: summary, ExtractionJSON: encoded, At: s.now()}
	return commitClaimCompletion(ctx, lifecycle, claim, completion)
}

func commitClaimCompletion(ctx context.Context, lifecycle meetinglifecycle.Module, claim *db.ProcessingClaim, completion meetinglifecycle.Completion) error {
	result, err := lifecycle.TransitionClaim(ctx, claim.Meeting.ID, claim.Token,
		meetinglifecycle.ProcessingCompleted{Completion: completion})
	if err != nil {
		return err
	}
	if !result.Applied {
		return fmt.Errorf("summarization claim expired")
	}
	return nil
}
