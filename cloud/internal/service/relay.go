package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// The relay forwards each /mcp request to the account's Mac over the WebSocket that the Mac opened,
// and stores nothing. The Mac checks the caller's token itself, so a relay that makes up a request
// cannot read a Meeting.

const (
	// MaxRelayReply bounds one answer from the Mac; one full transcript fits with room to spare.
	MaxRelayReply = 4 << 20
	// relayWait stays under the 10-second bound on every /mcp request.
	relayWait = 8 * time.Second
	// relayAnswerMargin is the time kept to write the offline answer before the request deadline.
	relayAnswerMargin = time.Second
	// relayLifetime ends a connection well before its access token can expire, so a revoked
	// device or a removed account cannot keep a connection open.
	relayLifetime = time.Hour
	relayPing     = 30 * time.Second
)

var errMacOffline = errors.New("mac offline")

// Relay holds at most one connected Mac per account. A new connection replaces the older one.
type Relay struct {
	mu   sync.Mutex
	macs map[string]*mac
}

type mac struct {
	conn    *websocket.Conn
	done    chan struct{}
	mu      sync.Mutex
	next    uint64
	waiting map[uint64]chan json.RawMessage
}

type relayRequest struct {
	ID    uint64          `json:"id"`
	Token string          `json:"token"`
	Body  json.RawMessage `json:"body"`
}

type relayReply struct {
	ID   uint64          `json:"id"`
	Body json.RawMessage `json:"body"`
}

func NewRelay() *Relay {
	return &Relay{macs: map[string]*mac{}}
}

// connect serves the Mac's WebSocket until it closes, fails a ping, or reaches relayLifetime.
func (r *Relay) connect() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		owner, _ := req.Context().Value(ownerKey{}).(string)
		// A handshake has no body. Without deadlines, the server would wait forever to drain one.
		if req.ContentLength != 0 || len(req.TransferEncoding) > 0 {
			http.Error(w, "a WebSocket handshake has no body", http.StatusBadRequest)
			return
		}
		// The server's read and write timeouts are for requests; this connection stays open.
		controller := http.NewResponseController(w)
		controller.SetReadDeadline(time.Time{})
		controller.SetWriteDeadline(time.Time{})
		conn, err := websocket.Accept(w, req, nil)
		if err != nil {
			return
		}
		conn.SetReadLimit(MaxRelayReply)
		m := &mac{conn: conn, done: make(chan struct{}), waiting: map[uint64]chan json.RawMessage{}}
		r.attach(owner, m)
		ctx, cancel := context.WithCancel(context.Background())
		timer := time.AfterFunc(relayLifetime, func() {
			conn.Close(websocket.StatusNormalClosure, "reconnect")
			cancel()
		})
		defer timer.Stop()
		defer cancel()
		go m.keepAlive(ctx, cancel)
		m.read(ctx)
		r.detach(owner, m)
		close(m.done)
		conn.Close(websocket.StatusNormalClosure, "reconnect")
	})
}

func (r *Relay) attach(owner string, m *mac) {
	r.mu.Lock()
	old := r.macs[owner]
	r.macs[owner] = m
	r.mu.Unlock()
	if old != nil {
		old.conn.Close(websocket.StatusPolicyViolation, "replaced by a newer connection")
	}
}

func (r *Relay) detach(owner string, m *mac) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.macs[owner] == m {
		delete(r.macs, owner)
	}
}

func (m *mac) keepAlive(ctx context.Context, cancel context.CancelFunc) {
	ticker := time.NewTicker(relayPing)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ping, stop := context.WithTimeout(ctx, relayPing/2)
			err := m.conn.Ping(ping)
			stop()
			if err != nil {
				cancel()
				return
			}
		}
	}
}

func (m *mac) read(ctx context.Context) {
	for {
		_, data, err := m.conn.Read(ctx)
		if err != nil {
			return
		}
		var reply relayReply
		if json.Unmarshal(data, &reply) != nil {
			return
		}
		m.mu.Lock()
		waiter := m.waiting[reply.ID]
		delete(m.waiting, reply.ID)
		m.mu.Unlock()
		if waiter != nil {
			waiter <- reply.Body
		}
	}
}

// forward sends one JSON-RPC message with the caller's token and waits for the Mac's answer. An
// empty answer means the message was a notification.
func (r *Relay) forward(ctx context.Context, owner, token string, body []byte) (json.RawMessage, error) {
	r.mu.Lock()
	m := r.macs[owner]
	r.mu.Unlock()
	if m == nil {
		return nil, errMacOffline
	}
	waiter := make(chan json.RawMessage, 1)
	m.mu.Lock()
	m.next++
	id := m.next
	m.waiting[id] = waiter
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		delete(m.waiting, id)
		m.mu.Unlock()
	}()
	frame, err := json.Marshal(relayRequest{ID: id, Token: token, Body: body})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, answerWait(ctx))
	defer cancel()
	if err := m.conn.Write(ctx, websocket.MessageText, frame); err != nil {
		return nil, errMacOffline
	}
	select {
	case reply := <-waiter:
		return reply, nil
	case <-m.done:
		return nil, errMacOffline
	case <-ctx.Done():
		return nil, errMacOffline
	}
}

// answerWait is relayWait, cut short so the offline answer is written before the request's own
// deadline (http.TimeoutHandler), which counts from before the token check.
func answerWait(ctx context.Context) time.Duration {
	wait := relayWait
	if deadline, ok := ctx.Deadline(); ok {
		wait = min(wait, time.Until(deadline)-relayAnswerMargin)
	}
	return wait
}

// relayTransport is the stateless Streamable HTTP side of /mcp: one JSON-RPC message per POST,
// answered with JSON. The token was verified by protect; the Mac verifies it again.
func relayTransport(relay *Relay) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, MaxBody+1))
		if err != nil || len(body) > MaxBody {
			http.Error(w, "invalid body", http.StatusRequestEntityTooLarge)
			return
		}
		var message struct {
			ID json.RawMessage `json:"id"`
		}
		if json.Unmarshal(body, &message) != nil || strings.TrimSpace(string(body)) == "null" {
			http.Error(w, "one JSON-RPC message required", http.StatusBadRequest)
			return
		}
		owner, _ := r.Context().Value(ownerKey{}).(string)
		reply, err := relay.forward(r.Context(), owner, bearerToken(r), body)
		if err != nil && len(message.ID) > 0 {
			reply, _ = json.Marshal(map[string]any{"jsonrpc": "2.0", "id": message.ID, "error": map[string]any{
				"code": -32001, "message": "Gappd on your Mac is not reachable. Open Gappd on your Mac and turn on Remote access in Settings, Connections."}})
		}
		if len(reply) == 0 || string(reply) == "null" {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(reply)
	})
}

func bearerToken(r *http.Request) string {
	fields := strings.Fields(r.Header.Get("Authorization"))
	if len(fields) != 2 {
		return ""
	}
	return fields[1]
}
