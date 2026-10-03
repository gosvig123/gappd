package service_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
)

// plantExpired writes expired copies with a chosen expiry age, which only elapsed time could
// produce through the API.
func plantExpired(t *testing.T, prefix string, count int, age time.Duration) {
	t.Helper()
	conn := lifecycleAdmin(t)
	fixtureTx(t, conn, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `ALTER TABLE cloud_meetings DISABLE TRIGGER guard_cloud_meeting_insert`); err != nil {
			return err
		}
		hours := age.Hours()
		if _, err := tx.Exec(ctx, `INSERT INTO meeting_lifecycle(id,owner_id,local_id,accepted_at,expires_at)
 SELECT meeting_copy_id($1||n,$1||n),$1||n,$1||n,
 statement_timestamp()-($2::double precision+720)*interval '1 hour',
 statement_timestamp()-$2::double precision*interval '1 hour'
 FROM generate_series(1,$3) n`, prefix, hours, count); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO cloud_meetings(id,owner_id,title,summary,transcript,started_at,updated_at,revision,document)
 SELECT meeting_copy_id(owner_id,local_id),owner_id,'expired','','',statement_timestamp(),statement_timestamp(),1,'{"version":1}'::jsonb
 FROM meeting_lifecycle WHERE owner_id LIKE $1`, prefix+"%"); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `ALTER TABLE cloud_meetings ENABLE TRIGGER guard_cloud_meeting_insert`)
		return err
	})
}

// drainBacklog empties the aggregate so a test can assert on a known baseline.
func drainBacklog(t *testing.T) {
	t.Helper()
	cleanup := meetingCleanupPool(t)
	for round := 0; round < 5; round++ {
		removed, err := service.CleanupMeeting(context.Background(), cleanup)
		if err != nil {
			t.Fatal(err)
		}
		if removed == 0 {
			return
		}
	}
	t.Fatal("the backlog did not drain")
}

func TestBacklogReportsWhatTheSweepHasNotRemoved(t *testing.T) {
	reader, _ := meetingDatabase(t)
	drainBacklog(t)
	ctx := context.Background()
	before, err := service.ReadBacklog(ctx, reader)
	if err != nil || before.ExpiredCopies != 0 {
		t.Fatalf("baseline: %+v %v", before, err)
	}
	// One hour past expiry is well inside the 24-hour deadline.
	plantExpired(t, "backlog-"+copyOwner("run"), 2, time.Hour)
	after, err := service.ReadBacklog(ctx, reader)
	if err != nil {
		t.Fatal(err)
	}
	if after.ExpiredCopies != 2 || after.Behind {
		t.Fatalf("a fresh backlog reported behind: %+v", after)
	}
	if after.OldestExpiredSeconds < 3500 || after.OldestExpiredSeconds > 3700 {
		t.Fatalf("oldest age is not the planted hour: %v", after.OldestExpiredSeconds)
	}
	if after.TargetSeconds != service.CleanupTargetSeconds {
		t.Fatalf("target: %v", after.TargetSeconds)
	}
}

func TestBacklogIsBehindPastTheDeadline(t *testing.T) {
	reader, _ := meetingDatabase(t)
	drainBacklog(t)
	plantExpired(t, "backlog-old-"+copyOwner("run"), 1, 56*time.Hour)
	backlog, err := service.ReadBacklog(context.Background(), reader)
	if err != nil {
		t.Fatal(err)
	}
	if !backlog.Behind || backlog.OldestExpiredSeconds < service.CleanupTargetSeconds {
		t.Fatalf("an overdue backlog was not reported: %+v", backlog)
	}
	// A sweep that catches up clears it and the flag with it.
	drainBacklog(t)
	caught, err := service.ReadBacklog(context.Background(), reader)
	if err != nil || caught.Behind || caught.ExpiredCopies != 0 {
		t.Fatalf("the sweep did not drain the backlog: %+v %v", caught, err)
	}
}

func TestTheBacklogFunctionExposesOnlyAggregates(t *testing.T) {
	reader, _ := meetingDatabase(t)
	plantExpired(t, "backlog-shape-"+copyOwner("run"), 1, time.Hour)
	// The reader has no access to the rows, so a direct count outside the function must fail.
	ctx := context.Background()
	var rows int
	if err := reader.QueryRow(ctx, `SELECT count(*) FROM meeting_lifecycle`).Scan(&rows); err != nil {
		t.Fatal("the reader could not count at all, so this test proves nothing:", err)
	}
	if rows != 0 {
		t.Fatalf("the reader saw %d lifecycle rows across accounts", rows)
	}
	if err := reader.QueryRow(ctx, `SELECT expired_copies,oldest_expired_seconds FROM cleanup_backlog()`).
		Scan(new(int64), new(float64)); err != nil {
		t.Fatal("the aggregate function is not callable:", err)
	}
}

func TestStatusPublishesTheBacklog(t *testing.T) {
	cleanup := statusCleanup(t)
	for _, field := range []string{"expired_copies", "behind"} {
		if _, ok := cleanup[field]; !ok {
			t.Fatalf("no %s in the response: %v", field, cleanup)
		}
	}
	// Nothing else may leak: the payload is the two numbers, the age and the target.
	if len(cleanup) != 4 {
		t.Fatalf("unexpected fields: %v", cleanup)
	}
}

// statusCleanup fetches the public status response and returns its cleanup section.
func statusCleanup(t *testing.T) map[string]any {
	t.Helper()
	reader, _ := meetingDatabase(t)
	host := httptest.NewServer(service.Handler(&service.Auth{Issuer: "https://issuer.test",
		Resource: "https://example.test/mcp", Keys: service.NewKeys("https://issuer.test")}, reader))
	t.Cleanup(host.Close)
	response, err := host.Client().Get(host.URL + "/status")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("status returned %d", response.StatusCode)
	}
	value := map[string]any{}
	if err = json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatal(err)
	}
	if value["status"] != "ok" {
		t.Fatalf("status: %v", value)
	}
	cleanup, _ := value["cleanup"].(map[string]any)
	if cleanup == nil {
		t.Fatalf("no cleanup section: %v", value)
	}
	return cleanup
}
