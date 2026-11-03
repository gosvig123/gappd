package service

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// discordContentLimit is Discord's 2,000-character message limit, with room for the header.
	discordContentLimit = 1900
	// droppedNoteRoom keeps room in a message for the note about dropped reports.
	droppedNoteRoom = 60
	alertQueueSize  = 500
)

// Alerts sends error reports to a Discord channel through its webhook. Each report is also logged.
// Reports wait in memory and are joined into as few messages as fit, so a flood stays within
// Discord's rate limit; when the queue is full, new reports are counted and dropped. Nothing is
// stored. A nil *Alerts only logs.
type Alerts struct {
	webhook string
	label   string
	client  *http.Client
	queue   chan string
	dropped atomic.Int64
	pending sync.WaitGroup
}

// AlertsFromEnv reads DISCORD_ERRORS_WEBHOOK_URL. Without it, reports are only logged.
func AlertsFromEnv() *Alerts {
	label := os.Getenv("RAILWAY_ENVIRONMENT_NAME")
	if label == "" {
		label = "cloud"
	}
	return NewAlerts(os.Getenv("DISCORD_ERRORS_WEBHOOK_URL"), label)
}

// NewAlerts starts the sender for webhook. label names the deployment in each message.
func NewAlerts(webhook, label string) *Alerts {
	if webhook == "" {
		return nil
	}
	a := &Alerts{webhook: webhook, label: label, client: &http.Client{Timeout: 10 * time.Second},
		queue: make(chan string, alertQueueSize)}
	go a.run()
	return a
}

// Report logs one line and queues it for Discord. It never blocks.
func (a *Alerts) Report(line string) {
	line = strings.ToValidUTF8(line, "?")
	if len(line) > discordContentLimit-100 {
		line = line[:discordContentLimit-100] + "…"
	}
	log.Printf("error report: %s", line)
	if a == nil {
		return
	}
	a.pending.Add(1)
	select {
	case a.queue <- line:
	default:
		a.pending.Done()
		a.dropped.Add(1)
	}
}

// ReportFailure reports what failed and why, without the error text.
func (a *Alerts) ReportFailure(what string, err error) {
	a.Report(fmt.Sprintf("🔴 %s: %s", what, errorKind(err)))
}

// Flush waits until every queued report was sent, or the timeout passed. Call it before exit.
func (a *Alerts) Flush(timeout time.Duration) {
	if a == nil {
		return
	}
	done := make(chan struct{})
	go func() { a.pending.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(timeout):
	}
}

func (a *Alerts) run() {
	var carry string
	for {
		first := carry
		if first == "" {
			first = <-a.queue
		}
		carry = ""
		content, lines := "`"+a.label+"`\n"+first, 1
	fill:
		for {
			select {
			case next := <-a.queue:
				if len(content)+1+len(next) > discordContentLimit-droppedNoteRoom {
					carry = next
					break fill
				}
				content, lines = content+"\n"+next, lines+1
			default:
				break fill
			}
		}
		if dropped := a.dropped.Swap(0); dropped > 0 {
			content += fmt.Sprintf("\n(%d more reports dropped: queue full)", dropped)
		}
		a.post(content)
		for range lines {
			a.pending.Done()
		}
	}
}

// post sends one message and waits out Discord's rate limit. Errors are logged by kind only: the
// error text of a failed request holds the webhook URL, which is a secret.
func (a *Alerts) post(content string) {
	body, _ := json.Marshal(map[string]any{"content": content, "allowed_mentions": map[string]any{"parse": []string{}}})
	for range 3 {
		response, err := a.client.Post(a.webhook, "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("error report not sent to Discord: %s", causeKind(err))
			return
		}
		response.Body.Close()
		if response.StatusCode == http.StatusTooManyRequests {
			time.Sleep(waitSeconds(response.Header.Get("Retry-After")))
			continue
		}
		if response.StatusCode >= 300 {
			log.Printf("error report not sent to Discord: HTTP %d", response.StatusCode)
		} else if response.Header.Get("X-RateLimit-Remaining") == "0" {
			time.Sleep(waitSeconds(response.Header.Get("X-RateLimit-Reset-After")))
		}
		return
	}
	log.Printf("error report not sent to Discord: still rate limited")
}

func waitSeconds(header string) time.Duration {
	seconds, err := strconv.ParseFloat(header, 64)
	if err != nil {
		seconds = 1
	}
	return time.Duration(min(max(seconds, 0.2), 60) * float64(time.Second))
}

var unsafeRouteText = regexp.MustCompile(`[^A-Za-z0-9/._-]`)

// reported reports each request that ends in a 5xx, panics, or notes an infrastructure failure.
// A report names the route, the status and the failure kinds; never a body, header or account.
func (a *Alerts) reported(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, collected := withFailures(r.Context())
		recorder := &statusRecorder{ResponseWriter: w}
		route := r.Method + " " + unsafeRouteText.ReplaceAllString(truncate(r.URL.Path, 60), "_")
		defer func() {
			if recovered := recover(); recovered != nil {
				if recovered == http.ErrAbortHandler {
					panic(recovered)
				}
				report := collected.panicReport()
				if report == "" {
					report = panicReport(recovered)
				}
				a.Report(fmt.Sprintf("🔥 `%s` %s", route, report))
				if recorder.status == 0 && !recorder.hijacked {
					http.Error(w, "internal error", http.StatusInternalServerError)
				}
				return
			}
			kinds := collected.list()
			if recorder.status < 500 && len(kinds) == 0 {
				return
			}
			status := "→ " + strconv.Itoa(recorder.status)
			if recorder.status == 0 {
				status = "→ 200"
			}
			cause := strings.Join(kinds, "; ")
			if cause == "" {
				cause = "no cause recorded (handler timeout or unhandled error)"
			}
			a.Report(fmt.Sprintf("🔴 `%s` %s · %s", route, status, cause))
		}()
		next.ServeHTTP(recorder, r.WithContext(ctx))
	})
}

// caught notes where a panic started, then raises it again. It runs inside http.TimeoutHandler,
// which raises the panic again in another goroutine, where its location is lost; there, reported
// answers 500 and discards anything the handler wrote.
func caught(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				if recovered != http.ErrAbortHandler {
					notePanic(r.Context(), panicReport(recovered))
				}
				panic(recovered)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// panicReport keeps runtime error text, which comes from the Go runtime, and only the type
// otherwise, then the service's own frames where the panic started: function and line only.
// Call it from the deferred function that recovered, while the panicking frames are still there.
func panicReport(recovered any) string {
	kind := fmt.Sprintf("%T", recovered)
	if err, ok := recovered.(runtime.Error); ok {
		kind = err.Error()
	}
	pcs := make([]uintptr, 32)
	frames := runtime.CallersFrames(pcs[:runtime.Callers(1, pcs)])
	var parts []string
	for frame, more := frames.Next(); len(parts) < 5; frame, more = frames.Next() {
		if strings.Contains(frame.Function, "gappd/cloud/") && !strings.HasSuffix(frame.File, "/alerts.go") {
			parts = append(parts, frame.Function[strings.LastIndex(frame.Function, "/")+1:]+":"+strconv.Itoa(frame.Line))
		}
		if !more {
			break
		}
	}
	if len(parts) == 0 {
		parts = append(parts, "unknown frame")
	}
	return "panic: " + kind + " at " + strings.Join(parts, " ← ")
}

func truncate(text string, limit int) string {
	if len(text) > limit {
		return text[:limit]
	}
	return text
}

// statusRecorder notes the response status. It passes Flush and Hijack through, so streamed MCP
// responses and the relay's WebSocket still work.
type statusRecorder struct {
	http.ResponseWriter
	status   int
	hijacked bool
}

func (s *statusRecorder) WriteHeader(status int) {
	if s.status == 0 {
		s.status = status
	}
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(data []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(data)
}

func (s *statusRecorder) Flush() {
	if flusher, ok := s.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijack not supported")
	}
	s.hijacked = true
	return hijacker.Hijack()
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }
