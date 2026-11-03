package main

import (
	"context"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	alerts := service.AlertsFromEnv()
	if err := run(alerts); err != nil {
		alerts.ReportFailure("cloud API stopped", err)
		alerts.Flush(5 * time.Second)
		log.Fatal("cloud startup or server failed")
	}
}

func run(alerts *service.Alerts) error {
	issuer, resource := os.Getenv("CLERK_ISSUER_URL"), os.Getenv("MCP_RESOURCE_URL")
	if !validURL(issuer, "") || !validURL(resource, "/mcp") || os.Getenv("DATABASE_URL") == "" {
		return service.WithCause("invalid configuration", nil)
	}
	if err := productionIdentity(issuer); err != nil {
		return err
	}
	pool, err := service.OpenPool(context.Background(), os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer pool.Close()
	return serve(issuer, resource, pool, alerts)
}

func serve(issuer, resource string, pool *pgxpool.Pool, alerts *service.Alerts) error {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	uploads, err := meetingPool()
	if err != nil {
		return err
	}
	defer uploads.Meeting.Close()
	// MCP_RELAY=on sends /mcp to the account's Mac. Without it, /mcp still reads cloud copies.
	if os.Getenv("MCP_RELAY") == "on" {
		uploads.Relay = service.NewRelay()
	}
	auth := &service.Auth{Issuer: issuer, Resource: resource, Keys: service.NewKeys(issuer),
		Limits: service.NewLimiter(), Revocations: service.NewRevocations(pool),
		// The reader pool cannot write, so the client list uses the writer pool.
		Clients: service.NewClientDirectory(uploads.Meeting), StatsToken: statsToken(), Alerts: alerts}
	server := &http.Server{Addr: ":" + port, Handler: service.HandlerWithUploads(auth, pool, uploads),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 32 << 10}
	return server.ListenAndServe()
}

// meetingPool opens the writer for cloud Meeting copies, which the desktop client uploads.
func meetingPool() (service.Uploads, error) {
	uploads := service.Uploads{ClientID: os.Getenv("GAPPD_DESKTOP_OAUTH_CLIENT_ID")}
	if uploads.ClientID == "" || os.Getenv("MEETING_STORAGE_DATABASE_URL") == "" {
		return uploads, service.WithCause("meeting storage configuration required", nil)
	}
	pool, err := service.OpenMeetingPool(context.Background(), os.Getenv("MEETING_STORAGE_DATABASE_URL"))
	uploads.Meeting = pool
	return uploads, err
}

// statsToken returns GAPPD_STATS_TOKEN, or nothing when it is too short to be a secret.
func statsToken() string {
	if token := os.Getenv("GAPPD_STATS_TOKEN"); len(token) >= 32 {
		return token
	}
	return ""
}

// A production deployment must not accept the shared development identity, which cannot verify
// domains or issue credentials that a real account can be revoked from.
func productionIdentity(issuer string) error {
	if os.Getenv("GAPPD_PRODUCTION_MODE") != "true" {
		return nil
	}
	if strings.Contains(issuer, ".clerk.accounts.dev") {
		return service.WithCause("production requires a production identity issuer", nil)
	}
	return nil
}

func validURL(raw, path string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil &&
		u.Path == path && u.RawQuery == "" && u.Fragment == "" && u.RawPath == ""
}
