package service

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxUsageBody bounds one Usage report. A valid report is about 400 bytes.
const MaxUsageBody = 1 << 10

// UsageReport is the anonymous daily report the desktop app sends when the user shares usage
// counts. It has no account, device, install id or free text: every field is a fixed value or a
// bucket, so a report cannot carry a title, a name or a path. docs/usage-reports.md lists the fields.
type UsageReport struct {
	Version           int    `json:"v"`
	AppVersion        string `json:"app_version"`
	Channel           string `json:"channel"`
	MacOSMajor        int    `json:"macos_major"`
	InstallWeek       string `json:"install_week"`
	MeetingsRecorded  string `json:"meetings_recorded"`
	RecordingMinutes  string `json:"recording_minutes"`
	MeetingsFailed    string `json:"meetings_failed"`
	ScreenVideoUsed   bool   `json:"screen_video_used"`
	NotesProvider     string `json:"notes_provider"`
	CalendarConnected bool   `json:"calendar_connected"`
	CloudSyncOn       bool   `json:"cloud_sync_on"`
	SpeakerLabelsOn   bool   `json:"speaker_labels_on"`
}

var (
	usageFields = []string{"v", "app_version", "channel", "macos_major", "install_week", "meetings_recorded",
		"recording_minutes", "meetings_failed", "screen_video_used", "notes_provider", "calendar_connected",
		"cloud_sync_on", "speaker_labels_on"}
	usageAppVersion  = regexp.MustCompile(`^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}(-beta\.[0-9]{1,6})?$`)
	usageInstallWeek = regexp.MustCompile(`^20[2-9][0-9]-W(0[1-9]|[1-4][0-9]|5[0-3])$`)
	usageChannels    = []string{"stable", "beta"}
	usageMeetings    = []string{"0", "1", "2-5", "6+"}
	usageMinutes     = []string{"0", "1-29", "30-119", "120+"}
	usageFailures    = []string{"0", "1", "2+"}
	usageProviders   = []string{"off", "local", "codex_exec", "claude_code", "pi_agent"}
)

var errUsageReport = errors.New("invalid usage report")

// ParseUsageReport accepts exactly the version-1 fields with allowed values, and nothing else.
func ParseUsageReport(body []byte) (UsageReport, error) {
	var keys map[string]json.RawMessage
	if json.Unmarshal(body, &keys) != nil || len(keys) != len(usageFields) {
		return UsageReport{}, errUsageReport
	}
	for key := range keys {
		if !slices.Contains(usageFields, key) {
			return UsageReport{}, errUsageReport
		}
	}
	var report UsageReport
	if json.Unmarshal(body, &report) != nil || !report.valid() {
		return UsageReport{}, errUsageReport
	}
	return report, nil
}

func (r UsageReport) valid() bool {
	return r.Version == 1 && usageAppVersion.MatchString(r.AppVersion) && slices.Contains(usageChannels, r.Channel) &&
		r.MacOSMajor >= 11 && r.MacOSMajor <= 99 && usageInstallWeek.MatchString(r.InstallWeek) &&
		slices.Contains(usageMeetings, r.MeetingsRecorded) && slices.Contains(usageMinutes, r.RecordingMinutes) &&
		slices.Contains(usageFailures, r.MeetingsFailed) && slices.Contains(usageProviders, r.NotesProvider)
}

// totals returns the field and value pairs that the report adds one to. The version is left out:
// it describes the format, not the use.
func (r UsageReport) totals() (fields, values []string) {
	pairs := [][2]string{{"app_version", r.AppVersion}, {"channel", r.Channel},
		{"macos_major", strconv.Itoa(r.MacOSMajor)}, {"install_week", r.InstallWeek},
		{"meetings_recorded", r.MeetingsRecorded}, {"recording_minutes", r.RecordingMinutes},
		{"meetings_failed", r.MeetingsFailed}, {"screen_video_used", strconv.FormatBool(r.ScreenVideoUsed)},
		{"notes_provider", r.NotesProvider}, {"calendar_connected", strconv.FormatBool(r.CalendarConnected)},
		{"cloud_sync_on", strconv.FormatBool(r.CloudSyncOn)}, {"speaker_labels_on", strconv.FormatBool(r.SpeakerLabelsOn)}}
	for _, pair := range pairs {
		fields, values = append(fields, pair[0]), append(values, pair[1])
	}
	return fields, values
}

// RecordUsage adds the report to today's totals. The report itself is not stored anywhere.
func RecordUsage(ctx context.Context, pool *pgxpool.Pool, report UsageReport) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	fields, values := report.totals()
	if _, err := pool.Exec(ctx, `SELECT record_usage($1,$2)`, fields, values); err != nil {
		return errors.New("usage unavailable")
	}
	return nil
}

// usageHandler takes anonymous Usage reports. It needs no token, because a report must not be
// linkable to an account, and it logs nothing about the caller.
func usageHandler(limits *Limiter, pool *pgxpool.Pool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if limits != nil && !limits.allow(ClassUsage, ClassUsage) {
			w.Header().Set("Retry-After", "60")
			http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, MaxUsageBody+1))
		if err != nil || len(body) > MaxUsageBody {
			http.Error(w, "invalid usage report", http.StatusRequestEntityTooLarge)
			return
		}
		report, err := ParseUsageReport(body)
		if err != nil {
			http.Error(w, "invalid usage report", http.StatusBadRequest)
			return
		}
		if err = RecordUsage(r.Context(), pool, report); err != nil {
			http.Error(w, "usage unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// UsageTotal is one daily total of one field value. usage_totals() never returns a total under 5.
type UsageTotal struct {
	Day     string `json:"day"`
	Field   string `json:"field"`
	Value   string `json:"value"`
	Reports int64  `json:"reports"`
}

// ReadUsageTotals returns the daily totals of the last 400 days.
func ReadUsageTotals(ctx context.Context, pool *pgxpool.Pool) ([]UsageTotal, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	rows, err := pool.Query(ctx, `SELECT to_char(day,'YYYY-MM-DD'),field,value,reports FROM usage_totals()`)
	if err != nil {
		return nil, errors.New("usage totals unavailable")
	}
	totals := []UsageTotal{}
	for rows.Next() {
		var total UsageTotal
		if err = rows.Scan(&total.Day, &total.Field, &total.Value, &total.Reports); err != nil {
			return nil, errors.New("usage totals unavailable")
		}
		totals = append(totals, total)
	}
	if rows.Err() != nil {
		return nil, errors.New("usage totals unavailable")
	}
	return totals, nil
}

// usageTotalsHandler serves the totals to the private stats dashboard, which holds the token.
func usageTotalsHandler(token string, limits *Limiter, pool *pgxpool.Pool) http.Handler {
	expected := []byte("Bearer " + token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), expected) != 1 {
			http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
			return
		}
		if limits != nil && !limits.allow(ClassRead, "stats") {
			w.Header().Set("Retry-After", "60")
			http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
			return
		}
		totals, err := ReadUsageTotals(r.Context(), pool)
		if err != nil {
			http.Error(w, "usage totals unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"totals": totals})
	})
}
