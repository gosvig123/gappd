package service_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/service"
)

// testDevice signs every write a test makes. Tests run one at a time, so one device is enough,
// and it is registered lazily for whichever account the token names.
var testDevice = newTestDevice()

type testDeviceKey struct {
	private ed25519.PrivateKey
	public  string
	known   map[string]bool
}

func newTestDevice() *testDeviceKey {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	return &testDeviceKey{private: private, public: base64.RawStdEncoding.EncodeToString(public), known: map[string]bool{}}
}

// register ensures the device is known for this token's account before a signed write.
func (d *testDeviceKey) register(t *testing.T, host, token string) {
	t.Helper()
	if d.known[token] {
		return
	}
	request, err := http.NewRequest("POST", host+"/device", strings.NewReader(`{"public_key":"`+d.public+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("device registration returned %d", response.StatusCode)
	}
	d.known[token] = true
}

// sign adds the device headers for one request. Nothing is registered here, so a caller can build
// a deliberately wrong signature.
func (d *testDeviceKey) sign(method, path, generation string, body []byte) http.Header {
	value := 0
	if generation != "" {
		value = atoiOrZero(generation)
	}
	message := []byte(service.DeviceMessage(method, path, service.DeviceID(d.private.Public().(ed25519.PublicKey)), value, body))
	header := http.Header{}
	header.Set(service.DeviceHeader, service.DeviceID(d.private.Public().(ed25519.PublicKey)))
	header.Set(service.SignatureHeader, base64.RawStdEncoding.EncodeToString(ed25519.Sign(d.private, message)))
	header.Set(service.GenerationHeader, generation)
	return header
}

func atoiOrZero(raw string) int {
	value := 0
	for _, digit := range raw {
		if digit < '0' || digit > '9' {
			return 0
		}
		value = value*10 + int(digit-'0')
	}
	return value
}

func TestDeviceRegistrationIsRequiredAndIdempotent(t *testing.T) {
	host, _, sign := uploadHost(t)
	owner := copyOwner("device")
	token := sign(owner)
	body := meetingDoc(localMeeting, 1, "Weekly sync")
	// Without a registered device and signature the write is refused.
	if code, _ := postRaw(t, host.URL+"/meeting", token, body, nil); code != 403 {
		t.Fatalf("unsigned upload returned %d", code)
	}
	testDevice.register(t, host.URL, token)
	// Registering the same key again is harmless.
	testDevice.known[token] = false
	testDevice.register(t, host.URL, token)
	if code, _ := postRaw(t, host.URL+"/meeting", token, body, testDevice.sign("POST", "/meeting", "", []byte(body))); code != 200 {
		t.Fatalf("signed upload returned %d", code)
	}
}

func TestDeviceSignatureBindsTheBodyAndThePath(t *testing.T) {
	host, _, sign := uploadHost(t)
	owner := copyOwner("device-bind")
	token := sign(owner)
	testDevice.register(t, host.URL, token)
	body := meetingDoc(localMeeting, 1, "Weekly sync")
	other := meetingDoc(localMeeting, 1, "Different")
	for _, attempt := range []struct {
		name string
		path string
		body string
	}{
		{"a signature for another body", "/meeting", other},
		{"a signature for another path", "/revoke", body},
	} {
		header := testDevice.sign("POST", attempt.path, "", []byte(body))
		if code, _ := postRaw(t, host.URL+"/meeting", token, attempt.body, header); code != 403 {
			t.Fatalf("%s was accepted: %d", attempt.name, code)
		}
	}
}

func TestUnknownDeviceIsRefused(t *testing.T) {
	host, _, sign := uploadHost(t)
	token := sign(copyOwner("device-unknown"))
	body := meetingDoc(localMeeting, 1, "Weekly sync")
	header := testDevice.sign("POST", "/meeting", "", []byte(body))
	if code, _ := postRaw(t, host.URL+"/meeting", token, body, header); code != 403 {
		t.Fatalf("an unregistered device was accepted: %d", code)
	}
	testDevice.register(t, host.URL, token)
	if code, _ := postRaw(t, host.URL+"/meeting", token, body, testDevice.sign("POST", "/meeting", "", []byte(body))); code != 200 {
		t.Fatal("a registered device was refused")
	}
}

func TestRevokedDeviceStopsWorkingAndCannotReturn(t *testing.T) {
	host, _, sign := uploadHost(t)
	owner := copyOwner("device-revoked")
	token := sign(owner)
	body := meetingDoc(localMeeting, 1, "Weekly sync")
	testDevice.register(t, host.URL, token)
	mustExec(t, lifecycleAdmin(t), `UPDATE account_devices SET revoked_at=statement_timestamp() WHERE owner_id=$1`, owner)
	if code, _ := postRaw(t, host.URL+"/meeting", token, body, testDevice.sign("POST", "/meeting", "", []byte(body))); code != 403 {
		t.Fatalf("a revoked device was accepted: %d", code)
	}
	testDevice.known[token] = false
	if status := registerDevice(t, host.URL, token); status != 403 {
		t.Fatalf("a revoked device re-registered: %d", status)
	}
}

func registerDevice(t *testing.T, host, token string) int {
	t.Helper()
	request, err := http.NewRequest("POST", host+"/device", strings.NewReader(`{"public_key":"`+testDevice.public+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	return response.StatusCode
}

// postRaw sends one write with explicit device headers.
func postRaw(t *testing.T, url, token, body string, header http.Header) (int, map[string]any) {
	t.Helper()
	request, err := http.NewRequest("POST", url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	for name, values := range header {
		for _, value := range values {
			if value != "" {
				request.Header.Set(name, value)
			}
		}
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	value := map[string]any{}
	if response.StatusCode == 200 {
		if err = json.NewDecoder(response.Body).Decode(&value); err != nil {
			t.Fatal(err)
		}
	}
	return response.StatusCode, value
}

var _ = httptest.NewServer
