package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if err := run(); err != nil {
		log.Fatal("cloud startup or server failed")
	}
}

func run() error {
	issuer, resource := os.Getenv("CLERK_ISSUER_URL"), os.Getenv("MCP_RESOURCE_URL")
	if !validURL(issuer, "") || !validURL(resource, "/mcp") || os.Getenv("DATABASE_URL") == "" {
		return errors.New("invalid configuration")
	}
	pool, err := service.OpenPool(context.Background(), os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer pool.Close()
	writer, err := demoPool()
	if err != nil {
		return err
	}
	if writer != nil {
		defer writer.Close()
	}
	return serve(issuer, resource, pool, writer)
}

func serve(issuer, resource string, pool, writer *pgxpool.Pool) error {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	uploads, err := meetingPool(writer)
	if err != nil {
		return err
	}
	if uploads.Meeting != nil {
		defer uploads.Meeting.Close()
	}
	auth := &service.Auth{Issuer: issuer, Resource: resource, Keys: service.NewKeys(issuer)}
	server := &http.Server{Addr: ":" + port, Handler: service.HandlerWithUploads(auth, pool, uploads),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 32 << 10}
	return server.ListenAndServe()
}

// meetingPool opens the real-copy writer only when its separate capability is explicitly on.
func meetingPool(demo *pgxpool.Pool) (service.Uploads, error) {
	uploads := service.Uploads{Demo: demo, ClientID: os.Getenv("GAPPD_DESKTOP_OAUTH_CLIENT_ID")}
	if os.Getenv("GAPPD_MEETING_STORAGE_ENABLED") != "true" {
		return uploads, nil
	}
	if uploads.ClientID == "" || os.Getenv("MEETING_STORAGE_DATABASE_URL") == "" {
		return uploads, errors.New("meeting storage configuration required")
	}
	pool, err := service.OpenMeetingPool(context.Background(), os.Getenv("MEETING_STORAGE_DATABASE_URL"))
	uploads.Meeting = pool
	return uploads, err
}

func validURL(raw, path string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil &&
		u.Path == path && u.RawQuery == "" && u.Fragment == "" && u.RawPath == ""
}

func demoPool() (*pgxpool.Pool, error) {
	if os.Getenv("GAPPD_SYNTHETIC_UPLOAD_ENABLED") != "true" {
		return nil, nil
	}
	if os.Getenv("GAPPD_DESKTOP_OAUTH_CLIENT_ID") == "" || os.Getenv("SYNTHETIC_UPLOAD_DATABASE_URL") == "" {
		return nil, errors.New("demo configuration required")
	}
	return service.OpenDemoPool(context.Background(), os.Getenv("SYNTHETIC_UPLOAD_DATABASE_URL"))
}
