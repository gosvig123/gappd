package liveactions

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
)

func TestGenerateRequiresStoredTranscript(t *testing.T) {
	m, id := fixture(t)
	m.Extractor = extractFunc(func(context.Context, string) (*ai.Extraction, error) {
		t.Fatal("extraction without text")
		return nil, nil
	})
	for _, text := range []string{"", "  "} {
		addSegment(t, m.Store, id, text)
		if _, err := m.Generate(context.Background(), id); err == nil {
			t.Fatal("expected no transcript error")
		}
	}
	assertDraft(t, m, id, nil)
}

func TestGenerateFrozenSnapshotAndDuplicate(t *testing.T) {
	m, id := fixture(t)
	addSegment(t, m.Store, id, "Draft the launch plan")
	m.Extractor = extractFunc(func(ctx context.Context, transcript string) (*ai.Extraction, error) {
		addSegment(t, m.Store, id, "New text after snapshot")
		if strings.Contains(transcript, "New text") {
			t.Fatal("snapshot changed")
		}
		if _, err := m.Generate(ctx, id); !errors.Is(err, db.ErrLiveActionsUnavailable) {
			t.Fatalf("duplicate: %v", err)
		}
		return extraction("Draft the launch plan"), nil
	})
	draft, err := m.Generate(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if draft.SegmentCount != 1 || draft.SnapshotID == "" || draft.SnapshotAt == "" {
		t.Fatalf("snapshot: %+v", draft)
	}
	assertDraft(t, m, id, draft)
}

func TestGenerateFailureRetryAndReplacement(t *testing.T) {
	m, id := fixture(t)
	addSegment(t, m.Store, id, "Draft the launch plan")
	first := generateTask(t, m, id, "First task")
	m.Extractor = extractFunc(func(context.Context, string) (*ai.Extraction, error) { return nil, errors.New("provider unavailable") })
	if _, err := m.Generate(context.Background(), id); err == nil {
		t.Fatal("expected provider failure")
	}
	assertDraft(t, m, id, first)
	second := generateTask(t, m, id, "Second task")
	if len(second.Actions) != 1 || second.Actions[0].Task != "Second task" {
		t.Fatalf("not replaced: %+v", second)
	}
	if first.SnapshotID != second.SnapshotID {
		t.Fatal("unchanged snapshot identity changed")
	}
	assertDraft(t, m, id, second)
	assertFinalUntouched(t, m.Store, id)
}

func TestGenerateEmptyReplacesPreviousDraft(t *testing.T) {
	m, id := fixture(t)
	addSegment(t, m.Store, id, "Hello")
	generateTask(t, m, id, "Old task")
	m.Extractor = extractFunc(func(context.Context, string) (*ai.Extraction, error) { return &ai.Extraction{}, nil })
	draft, err := m.Generate(context.Background(), id)
	if err != nil || len(draft.Actions) != 0 {
		t.Fatalf("empty: %+v, %v", draft, err)
	}
	assertDraft(t, m, id, draft)
}

func TestGenerateStopRejectsStalePersistence(t *testing.T) {
	m, id := fixture(t)
	addSegment(t, m.Store, id, "Draft the launch plan")
	prior := generateTask(t, m, id, "Previous draft")
	m.Extractor = extractFunc(func(context.Context, string) (*ai.Extraction, error) {
		if _, err := m.Store.Conn.Exec(`UPDATE meetings SET capture_status=? WHERE id=?`, db.CaptureStatusCaptured, id); err != nil {
			t.Fatal(err)
		}
		return extraction("Stale task"), nil
	})
	if _, err := m.Generate(context.Background(), id); !errors.Is(err, db.ErrLiveActionsUnavailable) {
		t.Fatalf("stop: %v", err)
	}
	assertDraft(t, m, id, prior)
	if _, err := m.Generate(context.Background(), id); !errors.Is(err, db.ErrLiveActionsUnavailable) {
		t.Fatalf("non-recording: %v", err)
	}
}

func TestGenerateCancellationRejectsStalePersistence(t *testing.T) {
	m, id := fixture(t)
	addSegment(t, m.Store, id, "Draft the launch plan")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.Extractor = extractFunc(func(context.Context, string) (*ai.Extraction, error) { cancel(); return extraction("Stale task"), nil })
	if _, err := m.Generate(ctx, id); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	assertDraft(t, m, id, nil)
	generateTask(t, m, id, "Retry")
}

func generateTask(t *testing.T, m Module, id, task string) *appprotocol.LiveActionDraft {
	t.Helper()
	m.Extractor = extractFunc(func(context.Context, string) (*ai.Extraction, error) { return extraction(task), nil })
	draft, err := m.Generate(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return draft
}
