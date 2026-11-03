package main

import (
	"context"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"log"
	"os"
	"time"
)

func main() {
	if err := run(); err != nil {
		alerts := service.AlertsFromEnv()
		alerts.ReportFailure("Meeting cleanup failed", err)
		alerts.Flush(5 * time.Second)
		log.Fatal("Meeting cleanup failed (details suppressed)")
	}
}

func run() error {
	url := os.Getenv("MEETING_CLEANUP_DATABASE_URL")
	if url == "" {
		return service.WithCause("cleanup configuration required", nil)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	count, err := service.CleanupMeeting(ctx, conn)
	if err != nil {
		return err
	}
	log.Printf("expired Meeting copies removed: %d", count)
	return nil
}
