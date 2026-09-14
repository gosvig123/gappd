package service_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newMeeting is a local Meeting that did not exist before the deletion.
const newMeeting = "1d4f0000-0000-4000-8000-000000000001"

// accountHost serves the upload, revoke and account routes with one identity.
func accountHost(t *testing.T) (*httptest.Server, *pgxpool.Pool, func(string) string) {
	t.Helper()
	reader, writer := meetingDatabase(t)
	auth, sign := signerScopes(t, "meetings:sync", "desktop")
	host := httptest.NewServer(service.HandlerWithUploads(auth, reader, service.Uploads{Meeting: writer, ClientID: "desktop"}))
	t.Cleanup(host.Close)
	return host, reader, sign
}

// postUpload sends one document with an optional account generation header.
func postUpload(t *testing.T, host, token, body string, generation int) (int, map[string]any) {
	t.Helper()
	request, err := http.NewRequest("POST", host+"/meeting", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if generation > 0 {
		request.Header.Set(service.GenerationHeader, strconv.Itoa(generation))
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

func postAccount(t *testing.T, host, token, path string) (int, map[string]any) {
	t.Helper()
	request, err := http.NewRequest("POST", host+path, strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
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

func TestDeleteAllRemovesEveryCopyAndBlocksUploads(t *testing.T) {
	host, reader, sign := accountHost(t)
	owner, other := copyOwner("delete-all"), copyOwner("delete-other")
	id := service.MeetingCopyID(owner, localMeeting)
	if code, _ := postUpload(t, host.URL, sign(owner), meetingDoc(localMeeting, 1, "Mine"), 0); code != 200 {
		t.Fatal("upload")
	}
	if code, _ := postUpload(t, host.URL, sign(other), meetingDoc(localMeeting, 1, "Theirs"), 0); code != 200 {
		t.Fatal("other upload")
	}
	code, ack := postAccount(t, host.URL, sign(owner), "/delete-all")
	if code != 200 || ack["status"] != "deleted" || ack["removed"] != float64(1) {
		t.Fatalf("delete-all: %d %v", code, ack)
	}
	if count, _, _ := copyRow(t, reader, owner, id); count != 0 {
		t.Fatal("copy remained")
	}
	// The identity is barred forever, so a device cannot restore it.
	if code, _ := postUpload(t, host.URL, sign(owner), meetingDoc(localMeeting, 9, "Mine"), 0); code != 403 {
		t.Fatalf("blocked upload returned %d", code)
	}
	// Another account is untouched.
	if count, _, _ := copyRow(t, reader, other, service.MeetingCopyID(other, localMeeting)); count != 1 {
		t.Fatal("another account lost its copy")
	}
}

func TestConsentIssuesAGenerationAndStaleDevicesCannotWrite(t *testing.T) {
	host, reader, sign := accountHost(t)
	owner := copyOwner("generation")
	if code, _ := postUpload(t, host.URL, sign(owner), meetingDoc(localMeeting, 1, "Mine"), 0); code != 200 {
		t.Fatal("upload")
	}
	if code, _ := postAccount(t, host.URL, sign(owner), "/delete-all"); code != 200 {
		t.Fatal("delete-all")
	}
	// Uploads stay blocked until an explicit consent.
	if code, _ := postUpload(t, host.URL, sign(owner), meetingDoc(newMeeting, 1, "Later"), 0); code != 403 {
		t.Fatal("uploads were not blocked")
	}
	generation := consent(t, host.URL, sign(owner))
	assertStaleGenerationsRefused(t, host.URL, sign(owner), generation)
	// Consent reopens uploads, and an erased identity stays erased for good.
	if code, _ := postUpload(t, host.URL, sign(owner), meetingDoc(localMeeting, 1, "Mine"), generation); code == 200 {
		t.Fatal("an erased identity was restored")
	}
	if code, _ := postUpload(t, host.URL, sign(owner), meetingDoc(newMeeting, 1, "Later"), generation); code != 200 {
		t.Fatal("the issued generation was refused")
	}
	if count, _, _ := copyRow(t, reader, owner, service.MeetingCopyID(owner, newMeeting)); count != 1 {
		t.Fatal("consented upload missing")
	}
}

func assertStaleGenerationsRefused(t *testing.T, host, token string, generation int) {
	t.Helper()
	for _, stale := range []int{0, generation - 1} {
		if code, _ := postUpload(t, host, token, meetingDoc(newMeeting, 1, "Later"), stale); code != 409 {
			t.Fatalf("generation %d was allowed to write: %d", stale, code)
		}
	}
}

func consent(t *testing.T, host, token string) int {
	t.Helper()
	code, ack := postAccount(t, host, token, "/consent")
	if code != 200 || ack["status"] != "allowed" {
		t.Fatalf("consent: %d %v", code, ack)
	}
	generation := int(ack["generation"].(float64))
	if generation < 2 {
		t.Fatalf("consent did not issue a new generation: %d", generation)
	}
	return generation
}

func TestAccountRoutesNeedTheDesktopClientAndAnEmptyBody(t *testing.T) {
	host, _, sign := accountHost(t)
	owner := copyOwner("account-auth")
	_, readSign := signerScopes(t, service.Scope, "desktop")
	for _, path := range []string{"/delete-all", "/consent"} {
		if code, _ := postAccount(t, host.URL, readSign(owner), path); code == 200 {
			t.Fatalf("%s accepted the read scope", path)
		}
		request, err := http.NewRequest("POST", host.URL+path, strings.NewReader("{}"))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer "+sign(owner))
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 400 {
			t.Fatalf("%s accepted a body: %d", path, response.StatusCode)
		}
	}
}

func TestDeletedAccountKeepsItsDeletionMarkers(t *testing.T) {
	host, reader, sign := accountHost(t)
	owner := copyOwner("delete-markers")
	if code, _ := postUpload(t, host.URL, sign(owner), meetingDoc(localMeeting, 1, "Mine"), 0); code != 200 {
		t.Fatal("upload")
	}
	if code, _ := postAccount(t, host.URL, sign(owner), "/delete-all"); code != 200 {
		t.Fatal("delete-all")
	}
	if !marked(t, reader, owner, service.MeetingCopyID(owner, localMeeting)) {
		t.Fatal("the identity was not barred")
	}
}
