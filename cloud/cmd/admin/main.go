package main

import (
	"context"
	"errors"
	"log"
	"os"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/admin"
	"github.com/jackc/pgx/v5"
)

func main() {
	if err := run(); err != nil {
		log.Fatal("admin command failed (details suppressed)")
	}
}

func run() error {
	if len(os.Args) != 2 || os.Getenv("ADMIN_DATABASE_URL") == "" {
		return errors.New("configuration required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, os.Getenv("ADMIN_DATABASE_URL"))
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	return execute(ctx, conn, os.Args[1])
}

func execute(ctx context.Context, conn *pgx.Conn, command string) error {
	switch command {
	case "migrate":
		return admin.Migrate(ctx, conn)
	case "provision":
		return admin.Provision(ctx, conn, os.Getenv("RUNTIME_DB_PASSWORD"))
	case "provision-demo":
		return admin.ProvisionDemo(ctx, conn, os.Getenv("DEMO_WRITER_DB_PASSWORD"))
	case "seed":
		return admin.Seed(ctx, conn, os.Getenv("DEMO_OWNER_ID"))
	default:
		return errors.New("use migrate, provision, provision-demo, or seed")
	}
}
