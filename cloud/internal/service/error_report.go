package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
)

// MaxErrorReportBody bounds one Error report. A report with a full stack is about 1.5 KiB.
const MaxErrorReportBody = 4 << 10

// ErrorReport is the anonymous report the desktop app sends when something fails, unless the user
// turned error reports off. It has no account, device, install id or error message: every field is
// a fixed value, a code name or an app-code location, so a report cannot carry a title, a name or a
// path. docs/error-reports.md lists the fields.
type ErrorReport struct {
	Version    int      `json:"v"`
	AppVersion string   `json:"app_version"`
	Channel    string   `json:"channel"`
	MacOSMajor int      `json:"macos_major"`
	Source     string   `json:"source"`
	Operation  string   `json:"operation"`
	ErrorName  string   `json:"error_name"`
	ErrorCode  string   `json:"error_code"`
	Stack      []string `json:"stack"`
	Repeats    int      `json:"repeats"`
}

var (
	errorReportFields = []string{"v", "app_version", "channel", "macos_major", "source", "operation",
		"error_name", "error_code", "stack", "repeats"}
	errorSources   = []string{"main", "renderer", "process", "meeting"}
	errorOperation = regexp.MustCompile(`^[a-z][a-z0-9-]{0,30}(\.[a-z0-9-]{1,30}){0,3}$`)
	// Names and codes have the shape of a code constant, not free text (desktop/src/shared/error-report.ts).
	errorName = regexp.MustCompile(`^(NonError|ProcessGone|MeetingFailed|([A-Z][A-Za-z0-9]{0,40})?(Error|Exception))$`)
	errorCode = regexp.MustCompile(`^([A-Z][A-Z0-9_]{1,39}|[0-9]{1,4}|abnormal-exit|killed|crashed|oom|launch-failed|integrity-failure|memory-eviction)?$`)
	// A frame is an optional function name, then one of Gappd's own bundle files and a line and column.
	errorFrame = regexp.MustCompile(`^([A-Za-z0-9_$.<>\[\] ]{1,80} )?(dist-electron/(main/main|preload/index)\.js|dist/assets/[A-Za-z0-9_-]{1,80}\.js|src/[A-Za-z0-9_/-]{1,100}\.tsx?|node_modules/\.vite/deps/[A-Za-z0-9_.-]{1,80}\.js):[0-9]{1,7}:[0-9]{1,7}$`)
)

var errErrorReport = errors.New("invalid error report")

// ParseErrorReport accepts exactly the version-1 fields with allowed values, and nothing else.
func ParseErrorReport(body []byte) (ErrorReport, error) {
	var keys map[string]json.RawMessage
	if json.Unmarshal(body, &keys) != nil || len(keys) != len(errorReportFields) {
		return ErrorReport{}, errErrorReport
	}
	for key := range keys {
		if !slices.Contains(errorReportFields, key) {
			return ErrorReport{}, errErrorReport
		}
	}
	var report ErrorReport
	if json.Unmarshal(body, &report) != nil || !report.valid() {
		return ErrorReport{}, errErrorReport
	}
	return report, nil
}

func (r ErrorReport) valid() bool {
	if r.Version != 1 || !usageAppVersion.MatchString(r.AppVersion) || !slices.Contains(usageChannels, r.Channel) ||
		r.MacOSMajor < 11 || r.MacOSMajor > 99 || !slices.Contains(errorSources, r.Source) ||
		!errorOperation.MatchString(r.Operation) || !errorName.MatchString(r.ErrorName) ||
		!errorCode.MatchString(r.ErrorCode) || len(r.Stack) > 10 || r.Repeats < 0 || r.Repeats > 100_000 {
		return false
	}
	for _, frame := range r.Stack {
		if !errorFrame.MatchString(frame) {
			return false
		}
	}
	return true
}

// line formats the report for the error channel. Every value passed validation, and the code
// spans keep Discord from reading _ or * in a name as formatting.
func (r ErrorReport) line() string {
	failure := "`" + r.ErrorName + "`"
	if r.ErrorCode != "" {
		failure += " `" + r.ErrorCode + "`"
	}
	line := fmt.Sprintf("🟣 desktop %s · %s · macOS %d · %s `%s` · %s", r.AppVersion, r.Channel, r.MacOSMajor,
		r.Source, r.Operation, failure)
	if r.Repeats > 0 {
		line += fmt.Sprintf(" (+%d repeats)", r.Repeats)
	}
	if len(r.Stack) > 0 {
		line += "\n    `" + strings.Join(r.Stack, " ← ") + "`"
	}
	return line
}

// errorReportHandler takes anonymous Error reports and forwards them to the error channel. It needs
// no token, because a report must not be linkable to an account; it stores nothing and logs
// nothing about the caller.
func errorReportHandler(limits *Limiter, alerts *Alerts) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if limits != nil && !limits.allow(ClassErrors, ClassErrors) {
			w.Header().Set("Retry-After", "60")
			http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, MaxErrorReportBody+1))
		if err != nil || len(body) > MaxErrorReportBody {
			http.Error(w, "invalid error report", http.StatusRequestEntityTooLarge)
			return
		}
		report, err := ParseErrorReport(body)
		if err != nil {
			http.Error(w, "invalid error report", http.StatusBadRequest)
			return
		}
		alerts.Report(report.line())
		w.WriteHeader(http.StatusNoContent)
	})
}
