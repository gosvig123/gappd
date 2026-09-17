package service

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Device headers on every write route. A bearer token alone is not enough.
const (
	DeviceHeader    = "X-Gappd-Device"
	SignatureHeader = "X-Gappd-Signature"
)

// DeviceSignatureVersion prefixes every signed message, so a signature for one purpose can never
// be replayed as another.
const DeviceSignatureVersion = "gappd-write-v1"

var errDeviceRefused = errors.New("device not authorized")

// DeviceMessage is the exact string a device signs. It binds the request to the device, to the
// account generation, and to the body it carries, so a signature cannot be moved to another
// request, device or body.
func DeviceMessage(method, path, deviceID string, generation int, body []byte) string {
	digest := sha256.Sum256(body)
	return fmt.Sprintf("%s\n%s\n%s\n%s\n%d\n%s", DeviceSignatureVersion, method, path, deviceID, generation, hex.EncodeToString(digest[:]))
}

// DeviceID is derived from the public key, so a device cannot choose an identity that collides
// with another device's key.
func DeviceID(key ed25519.PublicKey) string {
	digest := sha256.Sum256(key)
	return hex.EncodeToString(digest[:])
}

// RegisterDevice stores a device public key for this account. It is idempotent for the same key,
// and a revoked device can never register again.
func RegisterDevice(ctx context.Context, pool *pgxpool.Pool, owner string, key ed25519.PublicKey) (string, error) {
	if owner == "" || len(key) != ed25519.PublicKeySize {
		return "", errors.New("invalid device")
	}
	id := DeviceID(key)
	err := inMeetingTx(ctx, pool, owner, func(tx pgx.Tx) error {
		return storeDevice(ctx, tx, owner, id, key)
	})
	if err != nil {
		return "", err
	}
	return id, nil
}

// storeDevice keeps one key per device id. A revoked device never registers again.
func storeDevice(ctx context.Context, tx pgx.Tx, owner, id string, key ed25519.PublicKey) error {
	var revoked bool
	err := tx.QueryRow(ctx, `SELECT revoked_at IS NOT NULL FROM account_devices WHERE owner_id=$1 AND device_id=$2`, owner, id).Scan(&revoked)
	if err == nil {
		if revoked {
			return errDeviceRefused
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return errors.New("device unavailable")
	}
	_, err = tx.Exec(ctx, `INSERT INTO account_devices(owner_id,device_id,public_key) VALUES($1,$2,$3)
 ON CONFLICT (owner_id,device_id) DO NOTHING`, owner, id, []byte(key))
	if err != nil {
		return errors.New("device unavailable")
	}
	return nil
}

// AuthorizeDevice verifies one signature. A missing, unknown or revoked device, or a bad
// signature, is refused the same way.
func AuthorizeDevice(ctx context.Context, pool *pgxpool.Pool, owner, deviceID, signature string, message []byte) error {
	raw, err := base64.RawStdEncoding.DecodeString(signature)
	if err != nil || len(raw) != ed25519.SignatureSize || !validDeviceID(deviceID) {
		return errDeviceRefused
	}
	var key []byte
	err = withReadTx(ctx, pool, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT public_key FROM account_devices
 WHERE owner_id=$1 AND device_id=$2 AND revoked_at IS NULL`, owner, deviceID).Scan(&key)
	})
	if err != nil || len(key) != ed25519.PublicKeySize {
		return errDeviceRefused
	}
	if !ed25519.Verify(ed25519.PublicKey(key), message, raw) {
		return errDeviceRefused
	}
	return nil
}

func validDeviceID(id string) bool {
	if len(id) != 64 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}

// requestGenerationValue parses a generation header value.
func requestGenerationValue(raw string) (int, error) {
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 || value > 1<<31 {
		return 0, errors.New("invalid generation")
	}
	return value, nil
}
