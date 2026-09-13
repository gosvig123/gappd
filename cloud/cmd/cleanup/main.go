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
	url := os.Getenv("SYNTHETIC_CLEANUP_DATABASE_URL")
	if url == "" {
		return errors.New("cleanup configuration required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	count, err := service.CleanupDemo(ctx, conn)
	if err == nil {
		log.Printf("expired synthetic copies removed: %d", count)
	}
	return err
}
