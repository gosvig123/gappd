package meetingprocessing

import (
	"context"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
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
		s.runClaim(ctx, store, claim, result)
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

func (s Service) runClaim(ctx context.Context, store *db.DB, claim *db.ProcessingClaim, result *DrainResult) {
	stopRenewal := s.maintainClaim(ctx, store, claim)
	err := s.processClaim(ctx, store, claim)
	stopRenewal()
	if err == nil {
		result.Completed++
		return
	}
	if category(err) == ErrorTransient {
		_, _ = store.ReleaseClaim(ctx, claim.Meeting.ID, claim.Token, s.now())
		result.Requeued++
		return
	}
	_, _ = store.FailClaim(ctx, claim.Meeting.ID, claim.Token, s.now(), err)
	result.Failed++
}

func (s Service) processClaim(ctx context.Context, store *db.DB, claim *db.ProcessingClaim) error {
	switch claim.Stage {
	case db.QueueStageTranscription:
		return s.transcribeClaim(ctx, store, claim)
	case db.QueueStageSummarization:
		return s.summarizeClaim(ctx, store, claim)
	default:
		return deterministic(fmt.Errorf("inconsistent meeting artifacts"))
	}
}

func (s Service) transcribeClaim(ctx context.Context, store *db.DB, claim *db.ProcessingClaim) error {
	if claim.Meeting.AudioPath == nil || *claim.Meeting.AudioPath == "" {
		return deterministic(ErrNoAudio)
	}
	req := CapturedRequest{MeetingID: claim.Meeting.ID, AudioDir: *claim.Meeting.AudioPath, Language: claim.Meeting.Language}
	segments, _, err := s.capturedSegments(ctx, req, claim.Meeting.ID)
	if err != nil {
		return err
	}
	ok, err := store.CommitTranscript(ctx, claim.Meeting.ID, claim.Token, FormatTranscript(segments), segments, s.now())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("transcription claim expired")
	}
	return nil
}

func (s Service) summarizeClaim(ctx context.Context, store *db.DB, claim *db.ProcessingClaim) error {
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
	value := db.ProcessingCompletion{Title: extraction.Title, Transcript: *claim.Meeting.Transcript, Summary: summary, ExtractionJSON: encoded}
	return s.commitClaimSummary(ctx, store, claim, value)
}

func (s Service) commitClaimSummary(ctx context.Context, store *db.DB, claim *db.ProcessingClaim, value db.ProcessingCompletion) error {
	ok, err := store.CommitSummary(ctx, claim.Meeting.ID, claim.Token, value, s.now())
	if err != nil {
		return err
	}
	if !ok {
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
