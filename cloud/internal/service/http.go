package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const MaxBody = 16 << 10

type input struct {
	ID string `json:"id" jsonschema:"Globally unique synthetic Meeting UUID"`
}

func (a *Auth) ResourceMetadata() string {
	u, _ := url.Parse(a.Resource)
	return u.Scheme + "://" + u.Host + "/.well-known/oauth-protected-resource" + u.Path
}

// Uploads carries the optional write pools. A nil pool leaves its routes absent.
type Uploads struct {
	Demo     *pgxpool.Pool
	Meeting  *pgxpool.Pool
	ClientID string
}

func Handler(a *Auth, pool *pgxpool.Pool) http.Handler {
	return HandlerWithUploads(a, pool, Uploads{})
}

func HandlerWithDemo(a *Auth, pool, writer *pgxpool.Pool, clientID string) http.Handler {
	return HandlerWithUploads(a, pool, Uploads{Demo: writer, ClientID: clientID})
}

func HandlerWithUploads(a *Auth, pool *pgxpool.Pool, uploads Uploads) http.Handler {
	mux := http.NewServeMux()
	if uploads.ClientID != "" {
		uploadAuth := *a
		uploadAuth.RequiredScope, uploadAuth.ClientID = "meetings:sync", uploads.ClientID
		protect := func(h http.Handler) http.Handler {
			return uploadAuth.protect(uploadAuth.limited(ClassWrite, http.NewCrossOriginProtection().Handler(h)))
		}
		if uploads.Demo != nil {
			mux.Handle("POST /selected-demo-meeting", protect(selectedDemoHandler(uploads.Demo)))
			mux.Handle("DELETE /selected-demo-meeting", protect(selectedDemoHandler(uploads.Demo)))
			mux.Handle("POST /demo-meeting", protect(demoHandler(uploads.Demo)))
			mux.Handle("DELETE /demo-meeting", protect(demoHandler(uploads.Demo)))
		}
		if uploads.Meeting != nil {
			mux.Handle("POST /meeting", protect(meetingHandler(uploads.Meeting)))
			mux.Handle("DELETE /meeting", protect(meetingHandler(uploads.Meeting)))
			mux.Handle("POST /revoke", protect(revokeHandler(uploads.Meeting)))
		}
	}
	mux.Handle("/mcp", a.protect(a.limited(ClassRead, http.NewCrossOriginProtection().Handler(meetingTransport(pool)))))
	mux.HandleFunc("GET /.well-known/oauth-protected-resource", a.metadata)
	mux.HandleFunc("GET /.well-known/oauth-protected-resource/mcp", a.metadata)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok\n")) })
	mux.HandleFunc("GET /ready", readiness(pool))
	return bounded(mux)
}

func (a *Auth) metadata(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"resource": a.Resource,
		"authorization_servers": []string{a.Issuer}, "scopes_supported": []string{Scope},
		"bearer_methods_supported": []string{"header"}})
}

func readiness(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if pool.Ping(ctx) != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		w.Write([]byte("ready\n"))
	}
}

func bounded(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.RawQuery != "" {
			http.Error(w, "query parameters forbidden", 400)
			return
		}
		http.TimeoutHandler(next, 10*time.Second, "request timeout").ServeHTTP(w, r)
	})
}

func meetingTransport(pool *pgxpool.Pool) http.Handler {
	server := mcp.NewServer(&mcp.Implementation{Name: "gappd-cloud", Version: "0.1.0"}, nil)
	addGetMeeting(server, pool)
	addListMeetings(server, pool)
	addSearchMeetings(server, pool)
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server },
		&mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, MaxRequestBodyBytes: MaxBody})
}
