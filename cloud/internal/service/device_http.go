package service

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxDeviceBody bounds the small body that carries one public key.
const MaxDeviceBody = 256

type deviceInput struct {
	PublicKey string `json:"public_key"`
}

// deviceGate verifies the device signature on a write route. It buffers the body so the signature
// can cover it, then hands the same bytes to the handler.
func deviceGate(pool *pgxpool.Pool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, MaxDocumentBytes+1))
		if err != nil || len(body) > MaxDocumentBytes {
			http.Error(w, "invalid body", http.StatusRequestEntityTooLarge)
			return
		}
		owner, _ := r.Context().Value(ownerKey{}).(string)
		device, signature := r.Header.Get(DeviceHeader), r.Header.Get(SignatureHeader)
		generation, err := requestGeneration(r)
		if err != nil {
			http.Error(w, "invalid generation", http.StatusBadRequest)
			return
		}
		message := []byte(DeviceMessage(r.Method, r.URL.Path, device, generation, body))
		if err := AuthorizeDevice(r.Context(), pool, owner, device, signature, message); err != nil {
			http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		next.ServeHTTP(w, r)
	})
}

// deviceHandler registers this account's device public key. It is the one write route that does
// not need a signature, because it is how a signature becomes possible.
func deviceHandler(pool *pgxpool.Pool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, MaxDeviceBody+1))
		if err != nil || len(body) > MaxDeviceBody {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		key, err := parseDeviceInput(body)
		if err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		owner, _ := r.Context().Value(ownerKey{}).(string)
		id, err := RegisterDevice(r.Context(), pool, owner, key)
		if errors.Is(err, errDeviceRefused) {
			http.Error(w, "device not authorized", http.StatusForbidden)
			return
		}
		if err != nil {
			http.Error(w, "device unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "registered", "subject": owner, "device_id": id})
	})
}

func parseDeviceInput(body []byte) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var in deviceInput
	err := decoder.Decode(&in)
	if err == nil {
		err = decoder.Decode(&struct{}{})
	}
	if !errors.Is(err, io.EOF) {
		return nil, errors.New("invalid request")
	}
	key, err := base64.RawStdEncoding.DecodeString(in.PublicKey)
	if err != nil || len(key) != 32 {
		return nil, errors.New("invalid request")
	}
	return key, nil
}
