package service_test

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/admin"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const copyColumns = `(id,owner_id,title,summary,transcript,started_at,updated_at,revision,document)`

const insertCopySQL = `INSERT INTO cloud_meetings ` + copyColumns + ` VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8)`

var copyOwners atomic.Int64

// copyOwner keeps every test owner unique across runs, because the database persists.
func copyOwner(name string) string {
	return fmt.Sprintf("copy-%s-%d-%d", name, time.Now().UnixNano(), copyOwners.Add(1))
}

// meetingDatabase returns the reader pool and a provisioned real-copy writer pool.
func meetingDatabase(t *testing.T) (*pgxpool.Pool, *pgxpool.Pool) {
	t.Helper()
	reader := database(t)
	if os.Getenv("TEST_MEETING_DATABASE_URL") == "" {
		t.Skip("requires TEST_MEETING_DATABASE_URL")
	}
	provisionRole(t, &meetingOnce, func(ctx context.Context, conn *pgx.Conn) error {
		return admin.ProvisionMeeting(ctx, conn, "synthetic-test-password-only")
	})
	writer, err := service.OpenMeetingPool(context.Background(), os.Getenv("TEST_MEETING_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writer.Close)
	return reader, writer
}

// inWriterTx runs fn in one owner-scoped transaction and always releases the connection.
// fn commits explicitly when the test needs the write to persist.
func inWriterTx(t *testing.T, writer *pgxpool.Pool, owner string, fn func(pgx.Tx)) {
	t.Helper()
	tx, err := writer.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), `SELECT set_config('app.owner_id',$1,true)`, owner); err != nil {
		t.Fatal(err)
	}
	fn(tx)
}

func acceptCopy(t *testing.T, tx pgx.Tx, owner, localID string) string {
	t.Helper()
	id := service.MeetingCopyID(owner, localID)
	_, err := tx.Exec(context.Background(), `INSERT INTO meeting_lifecycle(id,owner_id,local_id,accepted_at,expires_at)
 VALUES($1,$2,$3,statement_timestamp(),statement_timestamp()+interval '720 hours') ON CONFLICT DO NOTHING`, id, owner, localID)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func insertCopy(t *testing.T, tx pgx.Tx, owner, id string, revision int) error {
	t.Helper()
	_, err := tx.Exec(context.Background(), insertCopySQL, id, owner, "Weekly sync", "Prototype review.",
		"[0:00] Kristian: Hello.", "2026-09-14T12:00:00Z", revision, `{"version":1}`)
	return err
}

// uploadCopy performs the intended upload: accept the identity, then insert the copy.
func uploadCopy(t *testing.T, writer *pgxpool.Pool, owner, localID string, revision int) string {
	t.Helper()
	var id string
	inWriterTx(t, writer, owner, func(tx pgx.Tx) {
		id = acceptCopy(t, tx, owner, localID)
		if err := insertCopy(t, tx, owner, id, revision); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
	return id
}

// visibleCopies counts what a pool can see for one owner under row level security.
func visibleCopies(t *testing.T, pool *pgxpool.Pool, owner, id string) int {
	t.Helper()
	tx, err := pool.BeginTx(context.Background(), pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), `SELECT set_config('app.owner_id',$1,true)`, owner); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = tx.QueryRow(context.Background(), `SELECT count(*) FROM cloud_meetings WHERE id=$1 AND owner_id=$2`, id, owner).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestMeetingCopyIsOwnerScoped(t *testing.T) {
	reader, writer := meetingDatabase(t)
	owner, other := copyOwner("scoped"), copyOwner("other")
	id := uploadCopy(t, writer, owner, "local-1", 1)
	if visibleCopies(t, reader, owner, id) != 1 {
		t.Fatal("owner cannot read the copy")
	}
	if visibleCopies(t, reader, other, id) != 0 {
		t.Fatal("cross-owner read")
	}
	inWriterTx(t, writer, other, func(tx pgx.Tx) {
		if err := insertCopy(t, tx, other, id, 1); err == nil {
			t.Fatal("cross-owner write")
		}
	})
	if visibleCopies(t, reader, owner, id) != 1 {
		t.Fatal("cross-owner write changed the copy")
	}
}

func TestMeetingCopyRequiresAnAcceptedIdentity(t *testing.T) {
	_, writer := meetingDatabase(t)
	owner := copyOwner("unaccepted")
	inWriterTx(t, writer, owner, func(tx pgx.Tx) {
		if err := insertCopy(t, tx, owner, service.MeetingCopyID(owner, "no-lifecycle"), 1); err == nil {
			t.Fatal("copy inserted without a lifecycle row")
		}
	})
}

func TestMeetingCopyRequiresARevision(t *testing.T) {
	_, writer := meetingDatabase(t)
	owner := copyOwner("bad-revision")
	for _, revision := range []int{0, -1} {
		inWriterTx(t, writer, owner, func(tx pgx.Tx) {
			id := acceptCopy(t, tx, owner, "bad-revision")
			if err := insertCopy(t, tx, owner, id, revision); err == nil {
				t.Fatalf("revision %d accepted", revision)
			}
		})
	}
}

func TestMeetingCopyRejectsStaleRevision(t *testing.T) {
	_, writer := meetingDatabase(t)
	owner := copyOwner("revision")
	id := uploadCopy(t, writer, owner, "local-2", 4)
	for _, revision := range []int{4, 3} {
		inWriterTx(t, writer, owner, func(tx pgx.Tx) {
			_, err := tx.Exec(context.Background(), `UPDATE cloud_meetings SET revision=$3,updated_at=statement_timestamp()
 WHERE id=$1 AND owner_id=$2`, id, owner, revision)
			if err == nil {
				t.Fatalf("revision %d overwrote revision 4", revision)
			}
		})
	}
	inWriterTx(t, writer, owner, func(tx pgx.Tx) {
		if _, err := tx.Exec(context.Background(), `UPDATE cloud_meetings SET revision=5 WHERE id=$1 AND owner_id=$2`, id, owner); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
}
