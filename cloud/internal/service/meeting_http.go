package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxDeleteBody bounds the small body that names one local Meeting.
const MaxDeleteBody = 256

type deleteInput struct {
	MeetingID string `json:"meeting_id"`
}

// GenerationHeader carries the account generation the caller was issued, so a device that only
// holds an older one cannot write after a delete-all.
const GenerationHeader = "X-Gappd-Generation"

func meetingHandler(pool *pgxpool.Pool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		owner, _ := r.Context().Value(ownerKey{}).(string)
		if r.Method == http.MethodDelete {
			acknowledgeMeetingDelete(w, r, pool, owner)
			return
		}
		acknowledgeMeetingUpload(w, r, pool, owner)
	})
}

func acknowledgeMeetingUpload(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, owner string) {
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxDocumentBytes+1))
	if err != nil || len(body) > MaxDocumentBytes {
		http.Error(w, "invalid document", http.StatusBadRequest)
		return
	}
	generation, err := requestGeneration(r)
	if err != nil {
		http.Error(w, "invalid generation", http.StatusBadRequest)
		return
	}
	id, err := UploadMeeting(r.Context(), pool, owner, generation, body)
	if err != nil {
		writeUploadRefusal(w, err)
		return
	}
	acknowledgeMeeting(w, r, pool, owner, "accepted", id)
}

// writeUploadRefusal maps one upload failure to one status, so an absent copy and another
// account's copy can never be told apart by a different message.
func writeUploadRefusal(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errDocument):
		http.Error(w, "invalid document", http.StatusBadRequest)
	case errors.Is(err, errStorageFull):
		http.Error(w, "account storage limit reached", http.StatusRequestEntityTooLarge)
	case errors.Is(err, errUploadsBlocked):
		http.Error(w, "uploads are off for this account", http.StatusForbidden)
	case errors.Is(err, errGenerationMismatch):
		http.Error(w, "stale account generation", http.StatusConflict)
	default:
		http.Error(w, "cloud copy unavailable", http.StatusServiceUnavailable)
	}
}

func acknowledgeMeetingDelete(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, owner string) {
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxDeleteBody+1))
	if err != nil || len(body) > MaxDeleteBody {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	localID, err := parseDeleteInput(body)
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := DeleteMeeting(r.Context(), pool, owner, localID); err != nil {
		http.Error(w, "cloud copy unavailable", http.StatusServiceUnavailable)
		return
	}
	acknowledgeMeeting(w, r, pool, owner, "deleted", "")
}

// requestGeneration reads the optional generation header. Absent means zero, which matches an
// account that has no state row.
func requestGeneration(r *http.Request) (int, error) {
	raw := strings.TrimSpace(r.Header.Get(GenerationHeader))
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 || value > 1<<31 {
		return 0, errors.New("invalid generation")
	}
	return value, nil
}

func parseDeleteInput(body []byte) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var in deleteInput
	err := decoder.Decode(&in)
	if err == nil {
		err = decoder.Decode(&struct{}{})
	}
	if !errors.Is(err, io.EOF) || !meetingID.MatchString(in.MeetingID) {
		return "", errors.New("invalid request")
	}
	return in.MeetingID, nil
}

func acknowledgeMeeting(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, owner, status, id string) {
	result := map[string]any{"status": status, "subject": owner}
	if status == "accepted" {
		revision, expiry, err := copyState(r, pool, owner, id)
		if err != nil {
			http.Error(w, "acknowledgment unavailable", http.StatusServiceUnavailable)
			return
		}
		result["id"], result["revision"], result["expires_at"] = id, revision, expiry
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func copyState(r *http.Request, pool *pgxpool.Pool, owner, id string) (int, string, error) {
	tx, err := pool.Begin(r.Context())
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(r.Context(), `SELECT set_config('app.owner_id',$1,true)`, owner); err != nil {
		return 0, "", err
	}
	var revision int
	var expiry string
	err = tx.QueryRow(r.Context(), `SELECT m.revision,l.expires_at::text FROM cloud_meetings m
 JOIN meeting_lifecycle l ON l.id=m.id AND l.owner_id=m.owner_id
 WHERE m.id=$1 AND m.owner_id=$2 AND l.deleted_at IS NULL`, id, owner).Scan(&revision, &expiry)
	if err != nil {
		return 0, "", err
	}
	return revision, expiry, tx.Commit(r.Context())
}
