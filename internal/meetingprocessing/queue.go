package meetingprocessing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
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
	if err := s.cleanupCompleted(ctx, store, &result); err != nil {
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
	if err := s.processClaim(ctx, lifecycle, claim); err != nil {
		return s.finalizeClaimError(ctx, lifecycle, claim, result, err)
	}
	result.Completed++
	return nil
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

func (s Service) cleanupCompleted(ctx context.Context, store *db.DB, result *DrainResult) error {
	meetings, err := store.CompletedWithAudio(ctx)
	if err != nil {
		return err
	}
	for _, meeting := range meetings {
		if err := s.deleteArtifact(*meeting.AudioPath); err != nil {
			result.CleanupFailed++
			continue
		}
		ok, err := store.ClearAudioPath(ctx, meeting.ID, *meeting.AudioPath)
		if err != nil {
			return err
		}
		if ok {
			result.Cleaned++
		}
	}
	return nil
}

func (s Service) deleteArtifact(path string) error {
	if s.ArtifactDeleter != nil {
		return s.ArtifactDeleter(path)
	}
	return audioartifact.DeleteSession(path)
}
