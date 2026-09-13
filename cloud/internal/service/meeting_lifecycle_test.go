package service_test

import (
	"context"
	"os"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/admin"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMeetingCopyCannotBeRestoredAfterDeletion(t *testing.T) {
	reader, writer := meetingDatabase(t)
	owner := copyOwner("deleted")
	id := uploadCopy(t, writer, owner, "local-3", 1)
	inWriterTx(t, writer, owner, func(tx pgx.Tx) {
		if _, err := tx.Exec(context.Background(), `UPDATE meeting_lifecycle SET deleted_at=statement_timestamp()
 WHERE id=$1 AND owner_id=$2`, id, owner); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(context.Background(), `DELETE FROM cloud_meetings WHERE id=$1 AND owner_id=$2`, id, owner); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
	if visibleCopies(t, reader, owner, id) != 0 {
		t.Fatal("deleted copy still readable")
	}
	inWriterTx(t, writer, owner, func(tx pgx.Tx) {
		if err := insertCopy(t, tx, owner, id, 9); err == nil {
			t.Fatal("deleted copy restored by a newer revision")
		}
	})
}

// An identity accepted 721 hours ago is already expired, so it never receives a copy.
func TestMeetingCopyCannotOutliveItsExpiry(t *testing.T) {
	reader, writer := meetingDatabase(t)
	owner := copyOwner("expired")
	inWriterTx(t, writer, owner, func(tx pgx.Tx) {
		id := service.MeetingCopyID(owner, "local-4")
		if _, err := tx.Exec(context.Background(), `INSERT INTO meeting_lifecycle(id,owner_id,local_id,accepted_at,expires_at)
 VALUES($1,$2,'local-4',statement_timestamp()-interval '721 hours',statement_timestamp()-interval '1 hour')`, id, owner); err != nil {
			t.Fatal(err)
		}
		if err := insertCopy(t, tx, owner, id, 1); err == nil {
			t.Fatal("expired identity accepted a copy")
		}
	})
	if visibleCopies(t, reader, owner, service.MeetingCopyID(owner, "local-4")) != 0 {
		t.Fatal("expired copy readable")
	}
}

func TestMeetingCopyLeavesTheSyntheticSliceAlone(t *testing.T) {
	reader, writer := meetingDatabase(t)
	owner := copyOwner("synthetic")
	id := uploadCopy(t, writer, owner, "local-5", 1)
	if _, err := service.Read(context.Background(), reader, owner, id); err == nil {
		t.Fatal("real copy visible to the synthetic read path")
	}
	if seeded, err := service.Read(context.Background(), reader, "user_synthetic", service.DemoID); err != nil || !seeded.Synthetic {
		t.Fatal("synthetic read regressed", err)
	}
	var rows int
	if err := lifecycleAdmin(t).QueryRow(context.Background(),
		`SELECT count(*) FROM meetings WHERE id=$1`, id).Scan(&rows); err != nil || rows != 0 {
		t.Fatal("real copy landed in the synthetic table", err)
	}
	demoWriter := demoWriterPool(t)
	if err := service.DeleteDemo(context.Background(), demoWriter, owner); err != nil {
		t.Fatal(err)
	}
	if visibleCopies(t, reader, owner, id) != 1 {
		t.Fatal("demo writer removed a real copy")
	}
}

func TestMeetingLifecycleRejectsFutureAndRewrite(t *testing.T) {
	_, writer := meetingDatabase(t)
	owner := copyOwner("lifecycle")
	id := service.MeetingCopyID(owner, "local-6")
	inWriterTx(t, writer, owner, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(), `INSERT INTO meeting_lifecycle(id,owner_id,local_id,accepted_at,expires_at)
 VALUES($1,$2,'local-6',statement_timestamp()+interval '1 hour',statement_timestamp()+interval '721 hours')`, id, owner)
		if err == nil {
			t.Fatal("future acceptance accepted")
		}
	})
	inWriterTx(t, writer, owner, func(tx pgx.Tx) {
		if _, err := tx.Exec(context.Background(), `INSERT INTO meeting_lifecycle(id,owner_id,local_id,deleted_at)
 VALUES($1,$2,'local-6',statement_timestamp())`, id, owner); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(context.Background(), `UPDATE meeting_lifecycle SET expires_at=statement_timestamp()+interval '720 hours'
 WHERE id=$1 AND owner_id=$2`, id, owner); err == nil {
			t.Fatal("accepted expiry rewritten")
		}
		if _, err := tx.Exec(context.Background(), `UPDATE meeting_lifecycle SET deleted_at=NULL WHERE id=$1 AND owner_id=$2`, id, owner); err == nil {
			t.Fatal("deletion marker cleared")
		}
	})
}

func demoWriterPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if os.Getenv("TEST_DEMO_DATABASE_URL") == "" {
		t.Skip("requires TEST_DEMO_DATABASE_URL")
	}
	database(t)
	conn := lifecycleAdmin(t)
	if err := admin.ProvisionDemo(context.Background(), conn, "synthetic-test-password-only"); err != nil {
		t.Fatal(err)
	}
	pool, err := service.OpenDemoPool(context.Background(), os.Getenv("TEST_DEMO_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}
