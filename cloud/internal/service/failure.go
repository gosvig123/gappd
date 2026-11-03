package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgconn"
)

// causedError keeps the cause of an "unavailable" failure for error reports. Its text is the fixed
// message only, so a client or a log never sees the cause, which can hold user data.
type causedError struct {
	message string
	cause   error
}

func (e causedError) Error() string { return e.message }
func (e causedError) Unwrap() error { return e.cause }

// WithCause returns the fixed message as an error that remembers its cause for error reports.
// message must be a literal from this code. cause can be nil.
func WithCause(message string, cause error) error {
	return causedError{message: message, cause: cause}
}

// errorKind describes a failure without its text: the fixed messages from this code, then the
// cause as a SQLSTATE code, a timeout, a network failure or a Go type. Error text from a driver
// or a library can hold user data, so it is never used.
func errorKind(err error) string {
	var parts []string
	for current := err; current != nil; current = errors.Unwrap(current) {
		if caused, ok := current.(causedError); ok {
			parts = append(parts, caused.message)
			continue
		}
		parts = append(parts, causeKind(current))
		break
	}
	return strings.Join(parts, " ← ")
}

func causeKind(err error) string {
	var pg *pgconn.PgError
	var connect *pgconn.ConnectError
	var network net.Error
	switch {
	case errors.As(err, &pg):
		return "SQLSTATE " + pg.Code
	case errors.As(err, &connect):
		return "database connection failed"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case pgconn.Timeout(err):
		return "database timeout"
	case errors.As(err, &network):
		return "network"
	default:
		return fmt.Sprintf("%T", err)
	}
}

// infrastructure reports whether err is a failure of the service, not a refused or invalid
// request: only errors made with WithCause are.
func infrastructure(err error) bool {
	var caused causedError
	return errors.As(err, &caused)
}

type failuresKey struct{}

// failures collects the infrastructure failures of one request, so the request's error report can
// say why, even when the response is not a 5xx, such as an MCP tool error.
type failures struct {
	mu    sync.Mutex
	kinds []string
	panic string
}

func withFailures(ctx context.Context) (context.Context, *failures) {
	collected := &failures{}
	return context.WithValue(ctx, failuresKey{}, collected), collected
}

// noteFailure records why a request failed, for its error report.
func noteFailure(ctx context.Context, err error) {
	collected, ok := ctx.Value(failuresKey{}).(*failures)
	if !ok || err == nil {
		return
	}
	collected.mu.Lock()
	defer collected.mu.Unlock()
	if len(collected.kinds) < 5 {
		collected.kinds = append(collected.kinds, errorKind(err))
	}
}

// notePanic records a recovered panic for the request's error report.
func notePanic(ctx context.Context, report string) {
	if collected, ok := ctx.Value(failuresKey{}).(*failures); ok {
		collected.mu.Lock()
		defer collected.mu.Unlock()
		collected.panic = report
	}
}

// panicReport is the panic noted by caught, or "".
func (f *failures) panicReport() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.panic
}

// noteInfrastructure records err when it is a failure of the service, and returns it. Tools use
// it, because a tool error is not a 5xx.
func noteInfrastructure(ctx context.Context, err error) error {
	if infrastructure(err) {
		noteFailure(ctx, err)
	}
	return err
}

func (f *failures) list() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.kinds...)
}
