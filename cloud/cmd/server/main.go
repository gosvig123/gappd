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
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	auth := &service.Auth{Issuer: issuer, Resource: resource, Keys: service.NewKeys(issuer)}
	server := &http.Server{Addr: ":" + port, Handler: service.Handler(auth, pool),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 32 << 10}
	return server.ListenAndServe()
}

func validURL(raw, path string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil &&
		u.Path == path && u.RawQuery == "" && u.Fragment == "" && u.RawPath == ""
}
