package main

import (
	"context"
	"errors"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"log"
	"os"
	"time"
)

func main() {
	if err := run(); err != nil {
		log.Fatal("synthetic cleanup failed (details suppressed)")
	}
}

func run() error {
	synthetic := os.Getenv("SYNTHETIC_CLEANUP_DATABASE_URL")
	meeting := os.Getenv("MEETING_CLEANUP_DATABASE_URL")
	if synthetic == "" && meeting == "" {
		return errors.New("cleanup configuration required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if synthetic != "" {
		count, err := sweep(ctx, synthetic, service.CleanupDemo)
		if err != nil {
			return err
		}
		log.Printf("expired synthetic copies removed: %d", count)
	}
	if meeting != "" {
		count, err := sweep(ctx, meeting, service.CleanupMeeting)
		if err != nil {
			return err
		}
		log.Printf("expired Meeting copies removed: %d", count)
	}
	return nil
}

type sweepFunc func(context.Context, *pgx.Conn) (int64, error)

func sweep(ctx context.Context, url string, run sweepFunc) (int64, error) {
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return 0, err
	}
	defer conn.Close(ctx)
	return run(ctx, conn)
}
