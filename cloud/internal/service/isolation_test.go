package service_test

import (
	"context"
	"os"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
)

func TestRLSWithoutApplicationFilter(t *testing.T) {
	pool := database(t)
	ctx := context.Background()
	for owner, want := range map[string]int{seededOwner: 1, "user_other": 0} {
		tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(ctx, `SELECT set_config('app.owner_id',$1,true)`, owner)
		if err != nil {
			t.Fatal(err)
		}
		var count int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM cloud_meetings`).Scan(&count)
		// Release the connection first: a failure with it held would block the pool's cleanup.
		if rollbackErr := tx.Rollback(ctx); rollbackErr != nil {
			t.Fatal(rollbackErr)
		}
		if err != nil || count != want {
			t.Fatalf("RLS: %d want %d, %v", count, want, err)
		}
	}
}

func TestRuntimeRejectsAdmin(t *testing.T) {
	if os.Getenv("TEST_ADMIN_DATABASE_URL") == "" {
		t.Skip("requires synthetic PostgreSQL")
	}
	pool, err := service.OpenPool(context.Background(), os.Getenv("TEST_ADMIN_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = pool.Ping(context.Background()); err == nil {
		t.Fatal("admin credentials accepted")
	}
}

func TestSchemaBounds(t *testing.T) {
	database(t)
	conn, err := pgx.Connect(context.Background(), os.Getenv("TEST_ADMIN_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	// Each update moves the revision forward, so only the size limit can refuse it.
	for _, sql := range []string{`UPDATE cloud_meetings SET revision=revision+1,title=repeat('x',513)`,
		`UPDATE cloud_meetings SET revision=revision+1,summary=repeat('x',65537)`,
		`UPDATE cloud_meetings SET revision=revision+1,transcript=repeat('x',1048577)`} {
		if _, err = conn.Exec(context.Background(), sql); err == nil {
			t.Fatal("schema limit missing")
		}
	}
}
