package liveactions

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
)

type Extractor interface {
	Extract(context.Context, string) (*ai.Extraction, error)
}

type Module struct {
	Store     *db.DB
	Extractor Extractor
}

func (m Module) Generate(ctx context.Context, id string) (*appprotocol.LiveActionDraft, error) {
	ctx, cancel := context.WithTimeout(ctx, db.LiveActionsTimeout)
	defer cancel()
	token, err := m.Store.ClaimLiveActions(ctx, id)
	if err != nil {
		return nil, err
	}
	defer m.Store.ReleaseLiveActions(id, token)
	return m.generateClaimed(ctx, id, token)
}

func (m Module) generateClaimed(ctx context.Context, id, token string) (*appprotocol.LiveActionDraft, error) {
	draft, transcript, err := m.snapshot(id)
	if err != nil {
		return nil, err
	}
	extraction, err := m.Extractor.Extract(ctx, transcript)
	if err != nil {
		return nil, err
	}
	draft.Actions = actions(extraction)
	if err := m.save(ctx, id, token, draft); err != nil {
		return nil, err
	}
	return draft, nil
}

func (m Module) save(ctx context.Context, id, token string, draft *appprotocol.LiveActionDraft) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	data, err := json.Marshal(draft)
	if err != nil {
		return err
	}
	return m.Store.SaveLiveActions(ctx, id, token, string(data))
}

func (m Module) Read(ctx context.Context, id string) (*appprotocol.LiveActionDraft, error) {
	data, err := m.Store.LiveActions(ctx, id)
	if err != nil || data == nil {
		return nil, err
	}
	var draft appprotocol.LiveActionDraft
	if err := json.Unmarshal([]byte(*data), &draft); err != nil {
		return nil, err
	}
	return &draft, nil
}

func (m Module) snapshot(id string) (*appprotocol.LiveActionDraft, string, error) {
	segments, err := m.Store.GetSegments(id)
	if err != nil {
		return nil, "", err
	}
	return snapshot(segments)
}

func availableSegments(segments []db.Segment) []db.Segment {
	available := make([]db.Segment, 0, len(segments))
	for _, segment := range segments {
		if strings.TrimSpace(segment.Text) != "" {
			available = append(available, segment)
		}
	}
	sort.Slice(available, func(i, j int) bool {
		if available[i].Start == available[j].Start {
			return available[i].ID < available[j].ID
		}
		return available[i].Start < available[j].Start
	})
	return available
}

func snapshot(segments []db.Segment) (*appprotocol.LiveActionDraft, string, error) {
	available := availableSegments(segments)
	if len(available) == 0 {
		return nil, "", errors.New("Live Transcript text is not available yet. Try again after a transcript chunk arrives.")
	}
	data, err := json.Marshal(available)
	if err != nil {
		return nil, "", err
	}
	hash := sha256.Sum256(data)
	draft := &appprotocol.LiveActionDraft{SnapshotID: hex.EncodeToString(hash[:]), SnapshotAt: time.Now().UTC().Format(time.RFC3339), SegmentCount: len(available)}
	for _, segment := range available {
		draft.LatestSegmentEnd = max(draft.LatestSegmentEnd, segment.End)
	}
	return draft, db.FormatTranscript(available), nil
}

func actions(extraction *ai.Extraction) []appprotocol.LiveActionItem {
	result := []appprotocol.LiveActionItem{}
	if extraction == nil {
		return result
	}
	for _, action := range extraction.ActionItems {
		result = append(result, appprotocol.LiveActionItem{Task: action.Task, Owner: action.Owner, Deadline: action.Deadline})
	}
	return result
}
